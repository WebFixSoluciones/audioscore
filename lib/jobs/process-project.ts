import {
  removeTemporaryDirectory,
  createTemporaryDirectory,
} from "@/lib/utils/temporary-directory";
import "server-only";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { adminFirebase } from "@/lib/firebase/admin";
import {
  temporaryBucket,
  trackAsset,
  assertStorageOwner,
} from "@/lib/firebase/storage";
import { ownedProject, projectRef } from "@/lib/security/ownership";
import {
  activePlan,
  exportAllowed,
  featureAllowed,
} from "@/lib/security/plan-guard";
import { finishJob, type Job } from "@/lib/billing/reservations";
import { audioPeaks, probeAudio, transcodeAudio } from "@/lib/audio/ffmpeg";
import { separateSources, transcribeAudio } from "@/lib/audio/adapters";
import {
  validateDocument,
  reviewWarnings,
} from "@/lib/music/notation-validation";
import { secondsToTicks } from "@/lib/music/tempo-map";
import { reviewWithGemini } from "@/lib/gemini/analyze";
import { generateExport } from "@/workers/generate-exports";
import { writeMidi } from "@/lib/music/midi-writer";
import { writeMusicXML } from "@/lib/music/musicxml";
import { renderNotation } from "@/lib/music/score-converter";
import { ApiError, log, messageOf } from "@/lib/utils/errors";
import { fingerprint } from "./idempotency";
import type { Account } from "@/lib/security/auth-guard";
import { transcribeLocalAudio } from "@/lib/audio/transcription/server";
export async function processProject(
  uid: string,
  projectId: string,
  jobId: string,
) {
  const { db } = adminFirebase(),
    pRef = projectRef(uid, projectId),
    jRef = pRef.collection("jobs").doc(jobId);
  const job = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(jRef);
    if (!snapshot.exists) throw new ApiError(404, "Trabajo inexistente");
    const current = snapshot.data() as Job;
    if (["completed", "failed", "cancelled"].includes(current.status))
      return null;
    if (current.leaseUntil && Date.parse(current.leaseUntil) > Date.now())
      throw new ApiError(409, "Trabajo en ejecución");
    const leased: Job = {
      ...current,
      status: "running",
      attempts: current.attempts + 1,
      leaseToken: randomUUID(),
      leaseUntil: new Date(Date.now() + 15 * 60000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    tx.update(jRef, leased);
    return leased;
  });
  if (!job) return { duplicate: true };
  const stage = async (name: string, progress: number) =>
    db.runTransaction(async (tx) => {
      const [js, ps] = await tx.getAll(jRef, pRef);
      if (
        js.data()?.status !== "running" ||
        js.data()?.leaseToken !== job.leaseToken ||
        ps.data()?.deleted
      )
        throw new ApiError(409, "Trabajo cancelado o bloqueo perdido");
      tx.update(jRef, {
        stage: name,
        progress,
        updatedAt: new Date().toISOString(),
      });
      if (job.kind === "analysis")
        tx.update(pRef, { status: name, updatedAt: new Date().toISOString() });
    });
  let folder: string | undefined;
  try {
    const user = (await db.doc(`users/${uid}`).get()).data();
    if (!user || user.status !== "active")
      throw new Error("Cuenta no disponible");
    const plan = await activePlan({ ...user, uid } as Account);
    if (job.kind === "export") {
      if (!job.format || !plan.allowedExports.includes(job.format))
        throw new Error("Tu plan ya no permite esta exportación");
      exportAllowed(
        plan,
        job.format,
        !job.sourceId && ["musicxml", "mei", "pdf", "zip"].includes(job.format),
      );
      await stage("generating_export", 20);
      const result = await generateExport(job, plan);
      await finishJob(job, "completed", {}, undefined, result.exportAsset);
      return { assetId: result.assetId, expiresAt: result.expiresAt };
    }
    await stage("validating", 5);
    const project = await ownedProject(uid, projectId);
    if (job.region) featureAllowed(plan, "advancedAnalysis");
    if (
      !project.storagePath ||
      !project.expiresAt ||
      Date.parse(project.expiresAt) <= Date.now()
    )
      throw new Error("El audio original ya caducó");
    assertStorageOwner(project.storagePath, uid, projectId);
    const file = temporaryBucket().file(project.storagePath),
      [metadata] = await file.getMetadata();
    const raw = (await pRef.get()).data();
    if (String(metadata.generation) !== String(raw?.inputGeneration))
      throw new Error(
        "El archivo cambió después de validarlo; confirma de nuevo la subida",
      );
    folder = await createTemporaryDirectory("job");
    const input = join(folder, "original"),
      normalized = join(folder, "normalized.wav");
    await temporaryBucket()
      .file(project.storagePath, { generation: Number(metadata.generation) })
      .download({ destination: input });
    const audioMetadata = await probeAudio(input);
    if (audioMetadata.durationSeconds > plan.maxFileDurationSeconds)
      throw new ApiError(403, "La duración supera el plan actual");
    if (
      !process.env.TRANSCRIPTION_PROVIDER_URL &&
      (job.region
        ? job.region[1] - job.region[0]
        : audioMetadata.durationSeconds) > 900
    )
      throw new ApiError(
        422,
        "El motor integrado admite hasta 15 minutos por análisis. Usa una región más corta.",
      );
    if (
      Math.abs(audioMetadata.durationSeconds - (project.durationSeconds ?? 0)) >
      0.02
    )
      throw new Error("Duración diferente de la reservada");
    await stage("normalizing", 15);
    await transcodeAudio(input, normalized, "wav", job.region);
    const acoustic = await audioPeaks(normalized);
    const normalizedPath = `temporary/${uid}/${projectId}/working/${job.id}.wav`;
    const expiresAt = new Date(
      Math.min(Date.now() + 86400000, Date.parse(project.expiresAt)),
    ).toISOString();
    await temporaryBucket().upload(normalized, {
      destination: normalizedPath,
      metadata: { contentType: "audio/wav", metadata: { expiresAt } },
    });
    await trackAsset(uid, projectId, normalizedPath, "working", expiresAt);
    await stage("global_analysis", 30);
    const warnings = [...acoustic.warnings];
    let stems: Awaited<ReturnType<typeof separateSources>> | undefined;
    if (
      plan.features.sourceSeparation &&
      process.env.SEPARATION_PROVIDER_URL &&
      !job.region
    ) {
      await stage("source_separation", 40);
      stems = await separateSources(
        uid,
        projectId,
        normalizedPath,
        expiresAt,
        plan.maxSources,
      );
      for (const source of stems.sources) {
        const asset = temporaryBucket().file(source.storagePath);
        const [meta] = await asset.getMetadata();
        if (!Number(meta.size) || Number(meta.size) > plan.maxFileBytes)
          throw new Error("Stem vacío o demasiado grande");
        const path = join(folder, `${source.id}.wav`);
        await asset.download({ destination: path });
        await probeAudio(path);
        await audioPeaks(path);
        await trackAsset(uid, projectId, source.storagePath, "stem", expiresAt);
      }
      warnings.push(...stems.warnings);
    } else
      warnings.push(
        "No se ejecutó separación de fuentes. No hay stems aislados nuevos.",
      );
    await stage("note_transcription", 55);
    let doc = validateDocument(
      process.env.TRANSCRIPTION_PROVIDER_URL
        ? await transcribeAudio(uid, projectId, normalizedPath, expiresAt, {
            title: project.title,
            sources: stems?.sources ?? [],
            ...(job.region
              ? {
                  originalSources: project.document?.sources,
                  originalTempoMap: project.document?.tempoMap,
                  region: job.region,
                }
              : {}),
            maxSources: plan.maxSources,
          })
        : await transcribeLocalAudio(normalized, project.title, {
            sourceId: job.region ? project.document?.sources[0]?.id : undefined,
            tempoMap: job.region
              ? [
                  {
                    startSeconds: 0,
                    bpm: project.document?.tempoMap[0]?.bpm ?? 120,
                    confidence: project.document?.tempoMap[0]?.confidence ?? 0,
                  },
                ]
              : undefined,
            onProgress: async (progress) => {
              await stage(
                "note_transcription",
                Math.round(55 + progress.progress * 0.12),
              );
            },
          }),
    );
    const analyzedDuration = job.region
      ? job.region[1] - job.region[0]
      : audioMetadata.durationSeconds;
    if (
      doc.provenance !== "transcription" ||
      doc.sources.length > plan.maxSources ||
      Math.abs(doc.durationSeconds - analyzedDuration) > 0.05
    )
      throw new Error(
        "La transcripción no coincide con el audio y los límites",
      );
    const validStemPaths = new Set(
      stems?.sources.map((s) => s.storagePath) ?? [],
    );
    doc.sources.forEach((s) => {
      if (s.storagePath && !validStemPaths.has(s.storagePath))
        throw new Error("La transcripción referencia un stem no validado");
      if (s.analogOrDigital !== "unknown" || s.evidence === "human")
        throw new Error(
          "El proveedor debe declarar evidencia automática y procedencia analógica/digital desconocida",
        );
    });
    if (job.region) {
      if (!project.document)
        throw new Error("La región requiere una transcripción previa");
      const original = project.document;
      const [start, end] = job.region;
      if (doc.sources.some((s) => !original.sources.some((o) => o.id === s.id)))
        throw new Error(
          "El proveedor regional debe conservar los IDs originales de las fuentes",
        );
      const moved = doc.events.map((e) => {
        const startSeconds = e.startSeconds + start;
        return {
          ...e,
          id: fingerprint({ jobId: job.id, eventId: e.id }),
          startSeconds,
          startTick: secondsToTicks(startSeconds, original.tempoMap),
          durationTicks: Math.max(
            1,
            secondsToTicks(
              startSeconds + e.durationSeconds,
              original.tempoMap,
            ) - secondsToTicks(startSeconds, original.tempoMap),
          ),
        };
      });
      // Preserve events crossing either boundary; replacing them would erase unselected audio.
      doc = validateDocument({
        ...original,
        events: [
          ...original.events.filter(
            (e) =>
              !(
                e.startSeconds >= start &&
                e.startSeconds + e.durationSeconds <= end
              ),
          ),
          ...moved,
        ],
        warnings: [
          ...original.warnings,
          "Las notas que cruzan el borde de la región se conservaron; revisa posibles solapamientos.",
        ],
        ...(original.analysis
          ? {
              analysis: {
                ...original.analysis,
                excludedNotes: [
                  ...(original.analysis.excludedNotes ?? []).filter(
                    (n) => n.startSeconds < start || n.startSeconds >= end,
                  ),
                  ...(doc.analysis?.excludedNotes ?? []).map((n) => ({
                    ...n,
                    startSeconds: n.startSeconds + start,
                  })),
                ],
              },
            }
          : {}),
        provenance: "transcription",
      });
    }
    await stage("instrument_detection", 68);
    const review = await reviewWithGemini(doc);
    doc = {
      ...doc,
      title: project.title,
      revision: project.revision + 1,
      warnings: [
        ...new Set([...doc.warnings, ...warnings, ...review.warnings]),
      ],
    };
    doc.events = doc.events.map((e) =>
      review.ambiguousEventIds.includes(e.id)
        ? { ...e, confidence: Math.min(e.confidence, 0.69) }
        : e,
    );
    await stage("midi_generation", 76);
    if (doc.events.length) writeMidi(doc);
    await stage("musicxml_generation", 83);
    const xml = doc.events.length ? writeMusicXML(doc) : undefined;
    await stage("pdf_generation", 88);
    if (xml) await renderNotation(xml, "pdf");
    await stage("quality_validation", 95);
    const checked = validateDocument(doc);
    checked.warnings = [...new Set(reviewWarnings(checked))];
    if (Buffer.byteLength(JSON.stringify(checked)) > 700000)
      throw new Error(
        "El documento supera 700 KB. Procesa una región más corta.",
      );
    const requiresReview =
      review.humanReviewRequired ||
      checked.warnings.length > 0 ||
      checked.confidence < 0.7;
    await finishJob(job, "completed", {
      document: checked,
      revision: checked.revision,
      status: requiresReview ? "needs_review" : "completed",
      audioMetadata,
      peaks: acoustic.peaks,
      summary: review.summary,
    });
    log("info", "job_completed", { uid, projectId, jobId });
    return { completed: true };
  } catch (e) {
    const latest = (await jRef.get()).data();
    if (latest?.status === "cancelled") return { cancelled: true };
    if (latest?.leaseToken !== job.leaseToken) throw e;
    const error = messageOf(e);
    log("error", "job_failed", {
      uid,
      projectId,
      jobId,
      attempt: job.attempts,
      error,
    });
    if (job.attempts >= 3 || (e instanceof ApiError && e.status < 500)) {
      await finishJob(job, "failed", {}, error);
      return { failed: true };
    }
    await jRef.update({
      status: "queued",
      leaseUntil: new Date(0).toISOString(),
      error,
      updatedAt: new Date().toISOString(),
    });
    throw e;
  } finally {
    if (folder) await removeTemporaryDirectory(folder);
  }
}
