import "server-only";
import { adminFirebase } from "@/lib/firebase/admin";
import { temporaryBucket, assertStorageOwner } from "@/lib/firebase/storage";
import { projectRef } from "@/lib/security/ownership";
import { enqueue } from "./queue";
import { finishJob, type Job } from "@/lib/billing/reservations";
import { log, messageOf } from "@/lib/utils/errors";
export async function cleanupAssets() {
  const { db } = adminFirebase();
  let deleted = 0,
    errors = 0;
  const assets = await db
    .collection("temporaryAssets")
    .where("deleted", "==", false)
    .where("expiresAt", "<=", new Date().toISOString())
    .limit(200)
    .get();
  for (const snapshot of assets.docs) {
    const a = snapshot.data();
    try {
      assertStorageOwner(a.storagePath, a.userId, a.projectId);
      await temporaryBucket()
        .file(a.storagePath)
        .delete({ ignoreNotFound: true });
      const now = new Date().toISOString();
      await snapshot.ref.update({ deleted: true, updatedAt: now });
      if (a.fileType === "original") {
        const ref = projectRef(a.userId, a.projectId);
        await db.runTransaction(async (tx) => {
          const p = (await tx.get(ref)).data();
          if (p?.storagePath === a.storagePath && !p?.activeJobId)
            tx.update(ref, { audioExpired: true, updatedAt: now });
        });
      }
      await db.collection("adminLogs").add({
        action: "delete_expired_asset",
        projectId: a.projectId,
        userId: a.userId,
        storagePath: a.storagePath,
        createdAt: now,
        updatedAt: now,
      });
      deleted++;
    } catch (e) {
      errors++;
      log("error", "cleanup_error", {
        assetId: snapshot.id,
        message: messageOf(e),
      });
    }
  }
  return { deleted, errors, more: assets.size === 200 };
}
export async function recoverUndispatchedJobs() {
  const { db } = adminFirebase();
  let dispatched = 0,
    failed = 0;
  const queued = await db
    .collectionGroup("jobs")
    .where("status", "==", "queued")
    .limit(100)
    .get();
  for (const d of queued.docs) {
    const job = d.data() as Job;
    try {
      if (Date.now() - Date.parse(job.createdAt) > 3600000) {
        await finishJob(
          job,
          "failed",
          {},
          "El trabajo no inició en una hora; se liberó la reserva",
        );
        failed++;
      } else if (!job.dispatched) {
        await enqueue(job);
        dispatched++;
      }
    } catch (e) {
      log("error", "job_recovery_error", {
        jobId: job.id,
        message: messageOf(e),
      });
    }
  }
  const stale = await db
    .collectionGroup("jobs")
    .where("status", "==", "running")
    .where("leaseUntil", "<", new Date(Date.now() - 3600000).toISOString())
    .limit(100)
    .get();
  for (const d of stale.docs) {
    const job = d.data() as Job;
    await finishJob(
      job,
      "failed",
      {},
      "El worker no completó el trabajo y el bloqueo caducó",
    );
    failed++;
  }
  return { dispatched, failed };
}
