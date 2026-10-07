import {
  removeTemporaryDirectory,
  createTemporaryDirectory,
} from "@/lib/utils/temporary-directory";
import "server-only";
import { zipSync, strToU8 } from "fflate";
import { writeMidi } from "@/lib/music/midi-writer";
import { writeMusicXML } from "@/lib/music/musicxml";
import { renderNotation } from "@/lib/music/score-converter";
import { validateDocument } from "@/lib/music/notation-validation";
import {
  temporaryBucket,
  trackAsset,
  assertStorageOwner,
} from "@/lib/firebase/storage";
import { projectRef } from "@/lib/security/ownership";
import { transcodeAudio } from "@/lib/audio/ffmpeg";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Job } from "@/lib/billing/reservations";
import type { Plan } from "@/lib/billing/plans";
export async function generateExport(job: Job, plan: Plan) {
  const doc = validateDocument(job.document);
  if (!job.format) throw new Error("Formato de exportación ausente");
  const sourceId = job.sourceId;
  if (sourceId && !doc.sources.some((s) => s.id === sourceId))
    throw new Error("Fuente inexistente");
  let bytes: Buffer;
  let mime = "application/octet-stream";
  let ext: string = job.format;
  if (job.format === "midi") {
    bytes = Buffer.from(writeMidi(doc, sourceId));
    mime = "audio/midi";
    ext = "mid";
  } else if (job.format === "musicxml") {
    bytes = Buffer.from(writeMusicXML(doc, sourceId));
    mime = "application/vnd.recordare.musicxml+xml";
  } else if (job.format === "json") {
    bytes = Buffer.from(JSON.stringify(doc, null, 2));
    mime = "application/json";
  } else if (job.format === "mei" || job.format === "pdf") {
    bytes = await renderNotation(writeMusicXML(doc, sourceId), job.format);
    mime = job.format === "pdf" ? "application/pdf" : "application/xml";
  } else if (job.format === "wav" || job.format === "mp3") {
    const source = doc.sources.find((s) => s.id === sourceId);
    if (!source?.storagePath)
      throw new Error("Selecciona un stem de audio disponible para exportar");
    assertStorageOwner(source.storagePath, job.userId, job.projectId);
    const folder = await createTemporaryDirectory("export");
    try {
      const input = join(folder, "input"),
        output = join(folder, `output.${job.format}`);
      await temporaryBucket()
        .file(source.storagePath)
        .download({ destination: input });
      await transcodeAudio(input, output, job.format);
      bytes = await readFile(output);
      mime = job.format === "wav" ? "audio/wav" : "audio/mpeg";
    } finally {
      await removeTemporaryDirectory(folder);
    }
  } else {
    const xml = writeMusicXML(doc, sourceId);
    const project = (await projectRef(job.userId, job.projectId).get()).data();
    const entries: Record<string, Uint8Array> = {
      "project.json": strToU8(
        JSON.stringify({
          id: job.projectId,
          title: doc.title,
          revision: doc.revision,
        }),
      ),
      "analysis.json": strToU8(JSON.stringify(doc)),
      "confidence.json": strToU8(
        JSON.stringify({
          sources: doc.sources.map((s) => ({
            id: s.id,
            confidence: s.confidence,
            evidence: s.evidence,
          })),
          events: doc.events.map((e) => ({
            id: e.id,
            confidence: e.confidence,
            reviewed: e.isHumanReviewed,
          })),
        }),
      ),
      "original-metadata.json": strToU8(
        JSON.stringify(project?.audioMetadata ?? {}),
      ),
      "midi/full.mid": writeMidi(doc, sourceId),
      "musicxml/full.musicxml": strToU8(xml),
      "mei/full.mei": await renderNotation(xml, "mei"),
      "pdf/full.pdf": await renderNotation(xml, "pdf"),
      "README.txt": strToU8(
        "AudioScore AI\nLos resultados requieren revisión humana. Consulte confidence.json y analysis.json.\nLos archivos fueron generados desde una única revisión de eventos musicales.\nLos stems incluidos son archivos reales del proveedor. El original solo se describe en original-metadata.json.\n",
      ),
    };
    let total = Object.values(entries).reduce((n, b) => n + b.byteLength, 0);
    for (const source of doc.sources.filter(
      (s) => (!sourceId || s.id === sourceId) && s.storagePath,
    )) {
      assertStorageOwner(source.storagePath!, job.userId, job.projectId);
      const asset = temporaryBucket().file(source.storagePath!);
      const [meta] = await asset.getMetadata();
      total += Number(meta.size);
      if (total > 150 * 1024 * 1024)
        throw new Error(
          "El ZIP excede 150 MB. Descarga los stems por separado.",
        );
      const [data] = await asset.download();
      entries[`stems/${source.id}.wav`] = data;
      entries[`midi/${source.id}.mid`] = writeMidi(doc, source.id);
      entries[`musicxml/${source.id}.musicxml`] = strToU8(
        writeMusicXML(doc, source.id),
      );
    }
    bytes = Buffer.from(zipSync(entries, { level: 3 }));
    mime = "application/zip";
  }
  const hours = ["wav", "mp3", "zip"].includes(job.format)
    ? 24
    : Math.min(7, plan.retentionDays) * 24;
  const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
  const storagePath = `temporary/${job.userId}/${job.projectId}/exports/${job.id}.${ext}`;
  await temporaryBucket()
    .file(storagePath)
    .save(bytes, {
      resumable: false,
      contentType: mime,
      metadata: {
        metadata: { expiresAt, userId: job.userId, projectId: job.projectId },
      },
    });
  await trackAsset(
    job.userId,
    job.projectId,
    storagePath,
    job.format,
    expiresAt,
  );
  const exportAsset = {
    id: job.id,
    storagePath,
    fileType: job.format,
    sourceId: sourceId ?? null,
    revision: doc.revision,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt,
    bytes: bytes.length,
  };
  return { assetId: job.id, expiresAt, exportAsset };
}
