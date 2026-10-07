import "server-only";
import { adminFirebase } from "@/lib/firebase/admin";
import { projectRef } from "@/lib/security/ownership";
import { checkQuota, type ExportFormat, type Plan } from "./plans";
import { ApiError } from "@/lib/utils/errors";
import { fingerprint, idempotencyId } from "@/lib/jobs/idempotency";
import type { MusicDocument } from "@/lib/music/types";
export type Job = {
  id: string;
  userId: string;
  projectId: string;
  kind: "analysis" | "export";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  attempts: number;
  month: string;
  minutesReserved: number;
  createdAt: string;
  updatedAt: string;
  fingerprint: string;
  leaseToken?: string;
  leaseUntil?: string;
  document?: MusicDocument;
  format?: ExportFormat;
  sourceId?: string;
  region?: [number, number];
  error?: string;
  dispatched?: boolean;
  assetId?: string;
};
export async function reserveJob(
  uid: string,
  projectId: string,
  key: string,
  plan: Plan,
  options: {
    kind: Job["kind"];
    format?: ExportFormat;
    sourceId?: string;
    region?: [number, number];
  },
): Promise<Job> {
  const { db } = adminFirebase();
  const id = idempotencyId(uid, projectId, key, options.kind);
  const jobRef = projectRef(uid, projectId).collection("jobs").doc(id);
  const month = new Date().toISOString().slice(0, 7);
  const usageRef = db.doc(`users/${uid}/usage/${id}`),
    monthRef = db.doc(`users/${uid}/usageMonths/${month}`),
    userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async (tx) => {
    const [existing, projectSnap, userSnap, balanceSnap] = await tx.getAll(
      jobRef,
      projectRef(uid, projectId),
      userRef,
      monthRef,
    );
    const requestFingerprint = fingerprint(options);
    if (existing.exists) {
      if (existing.data()?.fingerprint !== requestFingerprint)
        throw new ApiError(409, "La clave ya se utilizó con otra solicitud");
      return existing.data() as Job;
    }
    const project = projectSnap.data(),
      user = userSnap.data(),
      balance = balanceSnap.data();
    if (!project || project.userId !== uid)
      throw new ApiError(404, "Proyecto no encontrado");
    if (
      user?.status !== "active" ||
      user.subscriptionStatus !== "active" ||
      user.planId !== plan.id
    )
      throw new ApiError(403, "Cuenta o plan no disponible");
    if (project.activeJobId || (user.activeJobs ?? 0) >= plan.maxConcurrentJobs)
      throw new ApiError(409, "Ya hay un trabajo activo");
    let minutes = 0;
    if (options.kind === "analysis") {
      if (
        !project.storagePath ||
        ![
          "uploaded",
          "needs_review",
          "completed",
          "failed",
          "cancelled",
        ].includes(project.status) ||
        Date.parse(project.expiresAt) <= Date.now()
      )
        throw new ApiError(409, "Sube un audio válido antes de analizar");
      const duration = options.region
        ? options.region[1] - options.region[0]
        : project.durationSeconds;
      if (
        options.region &&
        (options.region[1] > project.durationSeconds ||
          options.region[0] >= options.region[1])
      )
        throw new ApiError(400, "Región fuera del audio");
      try {
        checkQuota(
          plan,
          duration,
          balance?.minutesUsed ?? 0,
          balance?.minutesReserved ?? 0,
          user.activeJobs ?? 0,
        );
      } catch (e) {
        throw new ApiError(403, (e as Error).message);
      }
      minutes = duration / 60;
      tx.set(
        monthRef,
        {
          minutesUsed: balance?.minutesUsed ?? 0,
          minutesReserved: (balance?.minutesReserved ?? 0) + minutes,
          month,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      tx.set(usageRef, {
        type: "audio_analysis",
        projectId,
        minutesReserved: minutes,
        minutesConsumed: 0,
        status: "reserved",
        month,
        idempotencyKey: key,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else if (
      !project.document?.events?.length ||
      !["completed", "needs_review"].includes(project.status)
    )
      throw new ApiError(409, "No hay un análisis musical para exportar");
    const now = new Date().toISOString();
    const job: Job = {
      id,
      userId: uid,
      projectId,
      kind: options.kind,
      status: "queued",
      stage: "queued",
      progress: 0,
      attempts: 0,
      month,
      minutesReserved: minutes,
      fingerprint: requestFingerprint,
      createdAt: now,
      updatedAt: now,
      ...(options.format ? { format: options.format } : {}),
      ...(options.sourceId ? { sourceId: options.sourceId } : {}),
      ...(options.region ? { region: options.region } : {}),
      ...(options.kind === "export" ? { document: project.document } : {}),
    };
    tx.set(jobRef, job);
    tx.update(userRef, {
      activeJobs: (user.activeJobs ?? 0) + 1,
      updatedAt: now,
    });
    tx.update(projectRef(uid, projectId), {
      activeJobId: id,
      ...(options.kind === "analysis" ? { status: "queued" } : {}),
      updatedAt: now,
    });
    return job;
  });
}
export async function finishJob(
  job: Job,
  status: "completed" | "failed" | "cancelled",
  patch: Record<string, unknown> = {},
  error?: string,
  exportAsset?: Record<string, unknown>,
) {
  const { db } = adminFirebase();
  const pRef = projectRef(job.userId, job.projectId),
    jRef = pRef.collection("jobs").doc(job.id),
    uRef = db.doc(`users/${job.userId}`),
    bRef = db.doc(`users/${job.userId}/usageMonths/${job.month}`),
    rRef = db.doc(`users/${job.userId}/usage/${job.id}`);
  await db.runTransaction(async (tx) => {
    const [js, us, bs, rs, ps] = await tx.getAll(jRef, uRef, bRef, rRef, pRef);
    const current = js.data();
    if (
      !current ||
      ["completed", "failed", "cancelled"].includes(current.status)
    )
      return;
    if (
      status === "completed" &&
      (!current.leaseToken || current.status !== "running")
    )
      throw new ApiError(
        409,
        "El trabajo debe estar en ejecución para finalizar",
      );
    if (status !== "cancelled" && current.leaseToken !== job.leaseToken)
      throw new ApiError(409, "El trabajo perdió su bloqueo");
    const now = new Date().toISOString();
    if (rs.data()?.status === "reserved") {
      const confirmed = status === "completed" ? job.minutesReserved : 0;
      tx.update(rRef, {
        status: status === "completed" ? "confirmed" : "released",
        minutesConsumed: confirmed,
        updatedAt: now,
      });
      tx.set(
        bRef,
        {
          minutesUsed: (bs.data()?.minutesUsed ?? 0) + confirmed,
          minutesReserved: Math.max(
            0,
            (bs.data()?.minutesReserved ?? 0) - job.minutesReserved,
          ),
          month: job.month,
          updatedAt: now,
        },
        { merge: true },
      );
    }
    tx.update(jRef, {
      status,
      stage: status,
      progress: status === "completed" ? 100 : current.progress,
      ...(error ? { error } : {}),
      ...(exportAsset
        ? { assetId: job.id, expiresAt: exportAsset.expiresAt }
        : {}),
      updatedAt: now,
    });
    if (status === "completed" && exportAsset)
      tx.set(pRef.collection("exports").doc(job.id), exportAsset);
    tx.update(uRef, {
      activeJobs: Math.max(0, (us.data()?.activeJobs ?? 0) - 1),
      updatedAt: now,
    });
    if (ps.exists && ps.data()?.activeJobId === job.id)
      tx.update(pRef, {
        ...patch,
        activeJobId: null,
        ...(job.kind === "analysis" && status !== "completed"
          ? { status }
          : {}),
        ...(error ? { error } : {}),
        updatedAt: now,
      });
  });
}
