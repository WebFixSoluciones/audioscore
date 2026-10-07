import {
  removeTemporaryDirectory,
  createTemporaryDirectory,
} from "@/lib/utils/temporary-directory";
import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { FieldValue, FieldPath } from "firebase-admin/firestore";
import { adminFirebase } from "@/lib/firebase/admin";
import {
  temporaryBucket,
  signedRead,
  trackAsset,
} from "@/lib/firebase/storage";
import { requireAccount, requireAdmin } from "@/lib/security/auth-guard";
import { ownedProject, projectRef, safeId } from "@/lib/security/ownership";
import {
  activePlan,
  featureAllowed,
  exportAllowed,
} from "@/lib/security/plan-guard";
import { rateLimit } from "@/lib/security/rate-limit";
import { ApiError, log, messageOf } from "@/lib/utils/errors";
import {
  newProjectSchema,
  uploadSchema,
  analyzeSchema,
  exportSchema,
  correctionSchema,
} from "@/lib/validation/api-schemas";
import { validateAudioFile } from "@/lib/audio/audio-validation";
import { probeAudio } from "@/lib/audio/ffmpeg";
import { assertTranscriptionConfigured } from "@/lib/audio/adapters";
import { idempotencyId } from "@/lib/jobs/idempotency";
import { reserveJob, finishJob, type Job } from "@/lib/billing/reservations";
import { enqueue, assertQueueConfigured } from "@/lib/jobs/queue";
import { saveCorrection, moveHistory } from "@/lib/music/corrections";
import { writeMusicXML } from "@/lib/music/musicxml";
import { renderNotation } from "@/lib/music/score-converter";
import { requireInternal } from "@/lib/security/internal-guard";
import { processProject } from "@/lib/jobs/process-project";
import { cleanupAssets, recoverUndispatchedJobs } from "@/lib/jobs/cleanup";
import { planSchema } from "@/lib/billing/plans";
import { publishedPlans } from "@/lib/billing/catalog";
const body = async (request: Request) => {
  if (Number(request.headers.get("content-length") ?? 0) > 900000)
    throw new ApiError(413, "Solicitud demasiado grande");
  const text = await request.text();
  if (text.length > 900000)
    throw new ApiError(413, "Solicitud demasiado grande");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new ApiError(400, "JSON inválido");
  }
};
export async function dispatch(
  request: Request,
  segments: string[],
): Promise<unknown> {
  const [resource, id, action, asset] = segments,
    method = request.method;
  if (segments.length > 5) throw new ApiError(404, "Ruta no encontrada");
  if (resource === "plans" && segments.length === 1 && method === "GET")
    return { plans: await publishedPlans() };
  if (resource === "internal") {
    if (process.env.VERCEL === "1")
      throw new ApiError(
        503,
        "Los trabajos internos deben ejecutarse en el worker de Cloud Run.",
      );
    await requireInternal(request);
    if (method !== "POST") throw new ApiError(405, "Método no permitido");
    if (segments.join("/") === "internal/jobs/process") {
      const input = z
        .object({ uid: z.string(), projectId: z.string(), jobId: z.string() })
        .strict()
        .parse(await body(request));
      safeId(input.uid);
      safeId(input.projectId);
      safeId(input.jobId);
      return processProject(input.uid, input.projectId, input.jobId);
    }
    if (segments.join("/") === "internal/cleanup")
      return {
        cleanup: await cleanupAssets(),
        recovery: await recoverUndispatchedJobs(),
      };
    throw new ApiError(404, "Ruta interna inexistente");
  }
  if (!["admin", "projects", "usage"].includes(resource))
    throw new ApiError(404, "Ruta no encontrada");
  const account = await requireAccount(request),
    { db } = adminFirebase();
  await rateLimit(
    account.uid,
    `${resource}-${method}`,
    method === "GET" ? 120 : 30,
  );
  if (resource === "admin") {
    requireAdmin(account);
    if (id === "users" && method === "GET") {
      const params = new URL(request.url).searchParams;
      const cursor = params.get("cursor");
      const email = params.get("email")?.trim().toLowerCase();
      if (email) z.email().max(254).parse(email);
      let query = db
        .collection("users")
        .orderBy(FieldPath.documentId())
        .limit(51);
      if (email) query = query.where("email", "==", email);
      if (cursor) query = query.startAfter(safeId(cursor));
      const rows = (await query.get()).docs;
      return {
        users: rows.slice(0, 50).map((doc) => ({ ...doc.data(), uid: doc.id })),
        nextCursor: rows.length > 50 ? rows[49].id : null,
      };
    }
    if (id === "users" && action && method === "PATCH") {
      const patch = z
        .object({
          status: z.enum(["active", "suspended", "deleted"]).optional(),
          planId: planSchema.shape.id.optional(),
          subscriptionStatus: z
            .enum(["active", "past_due", "cancelled"])
            .optional(),
        })
        .strict()
        .parse(await body(request));
      if (action === account.uid && patch.status && patch.status !== "active")
        throw new ApiError(
          409,
          "No puedes suspender tu propia cuenta administrativa",
        );
      const now = new Date().toISOString();
      await db.runTransaction(async (tx) => {
        const ref = db.doc(`users/${safeId(action)}`);
        if (!(await tx.get(ref)).exists)
          throw new ApiError(404, "Usuario inexistente");
        if (
          patch.planId &&
          !(await tx.get(db.doc(`plans/${patch.planId}`))).exists
        )
          throw new ApiError(404, "Plan inexistente");
        tx.update(ref, { ...patch, updatedAt: now });
        tx.set(db.collection("adminLogs").doc(), {
          actor: account.uid,
          target: action,
          action: "update_account",
          patch,
          createdAt: now,
          updatedAt: now,
        });
      });
      return { updated: true };
    }
    if (id === "plans" && method === "GET")
      return {
        plans: (await db.collection("plans").get()).docs.map((d) => d.data()),
      };
    if (id === "plans" && method === "PATCH") {
      const plan = planSchema.parse(await body(request)),
        now = new Date().toISOString();
      const batch = db.batch();
      batch.set(
        db.doc(`plans/${plan.id}`),
        { ...plan, updatedAt: now },
        { merge: true },
      );
      batch.set(db.collection("adminLogs").doc(), {
        actor: account.uid,
        action: "update_plan",
        planId: plan.id,
        createdAt: now,
        updatedAt: now,
      });
      await batch.commit();
      return { updated: true };
    }
    if (id === "jobs" && method === "GET")
      return {
        jobs: (
          await db
            .collectionGroup("jobs")
            .orderBy("createdAt", "desc")
            .limit(100)
            .get()
        ).docs.map((d) => d.data()),
      };
    if (id === "jobs" && action && asset === "retry" && method === "POST") {
      const { uid, projectId, idempotencyKey } = z
        .object({
          uid: z.string(),
          projectId: z.string(),
          idempotencyKey: z.string(),
        })
        .parse(await body(request));
      const target = (
        await projectRef(uid, projectId)
          .collection("jobs")
          .doc(safeId(action))
          .get()
      ).data() as Job | undefined;
      if (!target || !["failed", "cancelled"].includes(target.status))
        throw new ApiError(409, "El trabajo no permite reintento");
      const user = (await db.doc(`users/${safeId(uid)}`).get()).data();
      if (!user) throw new ApiError(404, "Usuario inexistente");
      const plan = await activePlan({ ...user, uid } as typeof account);
      const job = await reserveJob(uid, projectId, idempotencyKey, plan, {
        kind: target.kind,
        ...(target.format ? { format: target.format } : {}),
        ...(target.sourceId ? { sourceId: target.sourceId } : {}),
        ...(target.region ? { region: target.region } : {}),
      });
      await enqueue(job);
      await db.collection("adminLogs").add({
        actor: account.uid,
        action: "retry_job",
        previousJobId: action,
        jobId: job.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return { job };
    }
    if (id === "logs" && method === "GET")
      return {
        logs: (
          await db
            .collection("adminLogs")
            .orderBy("createdAt", "desc")
            .limit(100)
            .get()
        ).docs.map((d) => ({ id: d.id, ...d.data() })),
      };
    if (id === "usage" && method === "GET")
      return {
        usage: (
          await db
            .collectionGroup("usage")
            .orderBy("createdAt", "desc")
            .limit(100)
            .get()
        ).docs.map((d) => d.data()),
      };
    if (id === "settings" && method === "GET")
      return { settings: (await db.doc("system/config").get()).data() ?? {} };
    throw new ApiError(404, "Operación administrativa no encontrada");
  }
  const plan = await activePlan(account);
  if (resource === "usage" && id === "current" && method === "GET") {
    const month = new Date().toISOString().slice(0, 7);
    const balance = (
      await db.doc(`users/${account.uid}/usageMonths/${month}`).get()
    ).data();
    return {
      month,
      minutesUsed: balance?.minutesUsed ?? 0,
      minutesReserved: balance?.minutesReserved ?? 0,
      activeJobs: account.activeJobs,
      plan,
    };
  }
  if (resource !== "projects") throw new ApiError(404, "Ruta no encontrada");
  if (!id && method === "GET") {
    const docs = await db
      .collection(`users/${account.uid}/projects`)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    return {
      projects: docs.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => !(p as { deleted?: boolean }).deleted),
    };
  }
  if (!id && method === "POST") {
    const input = newProjectSchema.parse(await body(request)),
      projectId = idempotencyId(
        account.uid,
        "new",
        input.idempotencyKey,
        "project",
      ),
      ref = projectRef(account.uid, projectId),
      userRef = db.doc(`users/${account.uid}`);
    const project = await db.runTransaction(async (tx) => {
      const [existing, user] = await tx.getAll(ref, userRef);
      if (existing.exists) {
        if (existing.data()?.title !== input.title || existing.data()?.deleted)
          throw new ApiError(409, "Esta clave de creación ya se usó");
        return { ...existing.data(), id: projectId };
      }
      const data = user.data();
      if (
        data?.status !== "active" ||
        data.subscriptionStatus !== "active" ||
        data.planId !== plan.id
      )
        throw new ApiError(403, "Cuenta o plan cambió");
      if ((data.projectCount ?? 0) >= plan.maxProjects)
        throw new ApiError(403, "Alcanzaste el límite de proyectos de tu plan");
      const now = new Date().toISOString();
      const p = {
        id: projectId,
        userId: account.uid,
        title: input.title,
        status: "draft",
        revision: 0,
        createdAt: now,
        updatedAt: now,
      };
      tx.set(ref, p);
      tx.update(userRef, {
        projectCount: (data.projectCount ?? 0) + 1,
        updatedAt: now,
      });
      return p;
    });
    return { project };
  }
  if (!id) throw new ApiError(405, "Método no permitido");
  const project = await ownedProject(account.uid, id),
    ref = projectRef(account.uid, id);
  if (!action && method === "GET") return { project };
  if (!action && method === "PATCH") {
    const input = z
      .object({ title: z.string().trim().min(1).max(120) })
      .strict()
      .parse(await body(request));
    await ref.update({
      title: input.title,
      updatedAt: new Date().toISOString(),
    });
    return { updated: true };
  }
  if (!action && method === "DELETE") {
    await db.runTransaction(async (tx) => {
      const [p, u] = await tx.getAll(ref, db.doc(`users/${account.uid}`));
      if (p.data()?.activeJobId)
        throw new ApiError(409, "Cancela primero el trabajo activo");
      if (p.data()?.deleted) return;
      tx.update(ref, {
        deleted: true,
        status: "expired",
        document: FieldValue.delete(),
        updatedAt: new Date().toISOString(),
      });
      tx.update(db.doc(`users/${account.uid}`), {
        projectCount: Math.max(0, (u.data()?.projectCount ?? 0) - 1),
        updatedAt: new Date().toISOString(),
      });
    });
    const assets = await db
      .collection("temporaryAssets")
      .where("projectId", "==", id)
      .where("userId", "==", account.uid)
      .get();
    for (const a of assets.docs)
      await a.ref.update({ expiresAt: new Date().toISOString() });
    await cleanupAssets();
    return { deleted: true };
  }
  if (action === "upload-url" && method === "POST") {
    if (project.activeJobId)
      throw new ApiError(409, "Espera a que termine el trabajo");
    const input = uploadSchema.parse(await body(request)),
      ext = validateAudioFile(input.name, input.mime, input.size, plan),
      path = `temporary/${account.uid}/${id}/original/${randomUUID()}.${ext}`,
      expiresAt = new Date(Date.now() + 86400000).toISOString();
    const [url] = await temporaryBucket()
      .file(path)
      .getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + 10 * 60000,
        contentType: input.mime,
      });
    await db.runTransaction(async (tx) => {
      const p = (await tx.get(ref)).data();
      if (p?.activeJobId) throw new ApiError(409, "Proyecto ocupado");
      tx.update(ref, {
        pendingUpload: { path, ...input, expiresAt },
        updatedAt: new Date().toISOString(),
      });
    });
    await trackAsset(account.uid, id, path, "original", expiresAt);
    return { url, expiresAt, maximumBytes: plan.maxFileBytes };
  }
  if (action === "upload-complete" && method === "POST") {
    const snapshot = (await ref.get()).data(),
      pending = snapshot?.pendingUpload;
    if (!pending || Date.parse(pending.expiresAt) <= Date.now())
      throw new ApiError(409, "No hay una subida pendiente vigente");
    const file = temporaryBucket().file(pending.path),
      [meta] = await file.getMetadata();
    if (
      Number(meta.size) !== pending.size ||
      Number(meta.size) > plan.maxFileBytes ||
      meta.contentType !== pending.mime
    ) {
      await file.delete({ ignoreNotFound: true });
      throw new ApiError(
        422,
        "El archivo subido no coincide con lo autorizado",
      );
    }
    const folder = await createTemporaryDirectory("upload");
    try {
      const path = join(folder, "audio");
      await temporaryBucket()
        .file(pending.path, { generation: Number(meta.generation) })
        .download({ destination: path });
      const metadata = await probeAudio(path);
      if (metadata.durationSeconds > plan.maxFileDurationSeconds) {
        await file.delete({ ignoreNotFound: true });
        throw new ApiError(403, "El audio supera la duración de tu plan");
      }
      await db.runTransaction(async (tx) => {
        const p = (await tx.get(ref)).data();
        if (
          p?.activeJobId ||
          p?.pendingUpload?.path !== pending.path ||
          p?.deleted
        )
          throw new ApiError(409, "El proyecto cambió durante la validación");
        tx.update(ref, {
          storagePath: pending.path,
          durationSeconds: metadata.durationSeconds,
          audioMetadata: metadata,
          inputGeneration: String(meta.generation),
          expiresAt: pending.expiresAt,
          status: "uploaded",
          document: FieldValue.delete(),
          revision: (p?.revision ?? 0) + 1,
          pendingUpload: FieldValue.delete(),
          updatedAt: new Date().toISOString(),
        });
      });
      return { metadata, status: "uploaded" };
    } finally {
      await removeTemporaryDirectory(folder);
    }
  }
  if (["analyze", "reprocess-region"].includes(action) && method === "POST") {
    assertQueueConfigured();
    assertTranscriptionConfigured();
    const input = analyzeSchema.parse(await body(request));
    if (action === "reprocess-region") {
      featureAllowed(plan, "advancedAnalysis");
      if (!input.region || !project.document)
        throw new ApiError(
          400,
          "Selecciona una región en un análisis existente",
        );
    } else if (input.region)
      throw new ApiError(400, "Usa el endpoint de regiones");
    if (!process.env.TRANSCRIPTION_PROVIDER_URL) {
      const duration = input.region
        ? input.region[1] - input.region[0]
        : (project.durationSeconds ?? 0);
      if (duration > 900)
        throw new ApiError(
          422,
          "El motor integrado admite hasta 15 minutos por análisis. Selecciona una región más corta.",
        );
      if (input.region && project.document?.sources.length !== 1)
        throw new ApiError(
          422,
          "El reprocesado interno regional necesita una única pista de mezcla. Transcribe primero el audio completo con el motor integrado.",
        );
    }
    const job = await reserveJob(account.uid, id, input.idempotencyKey, plan, {
      kind: "analysis",
      ...(input.region ? { region: input.region } : {}),
    });
    try {
      await enqueue(job);
    } catch (e) {
      log("error", "queue_dispatch_pending", {
        jobId: job.id,
        message: messageOf(e),
      });
    }
    return { job };
  }
  if (action === "status" && method === "GET") {
    const raw = (await ref.get()).data();
    const job = raw?.activeJobId
      ? (await ref.collection("jobs").doc(raw.activeJobId).get()).data()
      : (
          await ref
            .collection("jobs")
            .orderBy("createdAt", "desc")
            .limit(1)
            .get()
        ).docs[0]?.data();
    return { project: raw, job: job ?? null };
  }
  if (action === "cancel" && method === "POST") {
    if (!project.activeJobId) return { cancelled: false };
    const job = (
      await ref.collection("jobs").doc(project.activeJobId).get()
    ).data() as Job;
    await finishJob(job, "cancelled");
    return { cancelled: true };
  }
  if (action === "sources" && method === "GET") {
    const urls: Record<string, string> = {};
    for (const s of project.document?.sources ?? [])
      if (s.storagePath && project.expiresAt) {
        try {
          urls[s.id] = await signedRead(
            account.uid,
            id,
            s.storagePath,
            project.expiresAt,
          );
        } catch {
          /* Expired stems keep their metadata. */
        }
      }
    return { sources: project.document?.sources ?? [], urls };
  }
  if (action === "events" && method === "GET")
    return { events: project.document?.events ?? [] };
  if (action === "corrections" && method === "GET")
    return {
      corrections: (
        await ref
          .collection("corrections")
          .orderBy("createdAt", "desc")
          .limit(50)
          .get()
      ).docs.map((d) => ({ id: d.id, ...d.data() })),
    };
  if (
    (action === "corrections" && method === "POST") ||
    (action === "events" && method === "PATCH")
  ) {
    featureAllowed(plan, "manualCorrection");
    const input = correctionSchema.parse(await body(request));
    if (input.document.sources.length > plan.maxSources)
      throw new ApiError(403, "Demasiadas fuentes para tu plan");
    return saveCorrection(
      account.uid,
      id,
      input.document,
      input.expectedRevision,
      input.operation,
    );
  }
  if (["undo", "redo"].includes(action) && method === "POST") {
    featureAllowed(plan, "manualCorrection");
    const input = z
      .object({ expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(await body(request));
    return moveHistory(
      account.uid,
      id,
      action as "undo" | "redo",
      input.expectedRevision,
    );
  }
  if (action === "scores" && method === "GET")
    return { document: project.document ?? null };
  if (action === "scores" && asset === "render" && method === "POST") {
    const input = z
      .object({ sourceId: z.string().optional() })
      .strict()
      .parse(await body(request));
    if (!project.document?.events.length)
      throw new ApiError(409, "No hay eventos para renderizar");
    const xml = writeMusicXML(project.document, input.sourceId);
    return { svg: (await renderNotation(xml, "svg")).toString("utf8") };
  }
  if (action === "exports" && method === "GET")
    return {
      exports: (
        await ref
          .collection("exports")
          .orderBy("createdAt", "desc")
          .limit(100)
          .get()
      ).docs.map((d) => d.data()),
    };
  if (action === "export" && method === "POST") {
    assertQueueConfigured();
    const input = exportSchema.parse(await body(request));
    exportAllowed(
      plan,
      input.format,
      !input.sourceId &&
        ["musicxml", "mei", "pdf", "zip"].includes(input.format),
    );
    if (
      input.sourceId &&
      !project.document?.sources.some((s) => s.id === input.sourceId)
    )
      throw new ApiError(404, "Fuente inexistente");
    const job = await reserveJob(account.uid, id, input.idempotencyKey, plan, {
      kind: "export",
      format: input.format,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    });
    try {
      await enqueue(job);
    } catch (e) {
      log("error", "queue_dispatch_pending", {
        jobId: job.id,
        message: messageOf(e),
      });
    }
    return { job };
  }
  if (action === "download" && asset && method === "GET") {
    if (asset === "original") {
      if (!project.storagePath || !project.expiresAt)
        throw new ApiError(404, "No hay audio original");
      return {
        url: await signedRead(
          account.uid,
          id,
          project.storagePath,
          project.expiresAt,
        ),
      };
    }
    const file = (
      await ref.collection("exports").doc(safeId(asset)).get()
    ).data();
    if (!file) throw new ApiError(404, "Exportación inexistente");
    if (!plan.allowedExports.includes(file.fileType))
      throw new ApiError(403, "Tu plan no permite este formato");
    return {
      url: await signedRead(account.uid, id, file.storagePath, file.expiresAt),
      expiresAt: file.expiresAt,
    };
  }
  throw new ApiError(404, "Operación no encontrada");
}
