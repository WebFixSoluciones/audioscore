import "server-only";
import { CloudTasksClient } from "@google-cloud/tasks";
import { ApiError } from "@/lib/utils/errors";
import { projectRef } from "@/lib/security/ownership";
import type { Job } from "@/lib/billing/reservations";
export function assertQueueConfigured() {
  if (
    ![
      process.env.CLOUD_TASKS_QUEUE,
      process.env.CLOUD_TASKS_LOCATION,
      process.env.GOOGLE_CLOUD_PROJECT_ID,
      process.env.CLOUD_TASKS_SERVICE_ACCOUNT,
      process.env.WORKER_URL,
      process.env.INTERNAL_JOB_SECRET,
    ].every(Boolean)
  )
    throw new ApiError(
      503,
      "Configura Cloud Tasks y el worker antes de iniciar un análisis",
    );
  if (
    !process.env.WORKER_URL?.startsWith("https://") ||
    (process.env.INTERNAL_JOB_SECRET?.length ?? 0) < 32
  )
    throw new ApiError(
      503,
      "El worker requiere HTTPS y un secreto interno de al menos 32 caracteres",
    );
}
export async function enqueue(job: Job) {
  assertQueueConfigured();
  const client = new CloudTasksClient({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    ...(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY
      ? {
          credentials: {
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
            private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
          },
        }
      : {}),
  });
  const parent = client.queuePath(
    process.env.GOOGLE_CLOUD_PROJECT_ID!,
    process.env.CLOUD_TASKS_LOCATION!,
    process.env.CLOUD_TASKS_QUEUE!,
  );
  const base = process.env.WORKER_URL!.replace(/\/$/, "");
  if (!base.startsWith("https://"))
    throw new ApiError(503, "El worker debe usar HTTPS");
  try {
    await client.createTask({
      parent,
      task: {
        name: `${parent}/tasks/${job.id}`,
        dispatchDeadline: { seconds: 1800 },
        httpRequest: {
          httpMethod: "POST",
          url: `${base}/api/internal/jobs/process`,
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Secret": process.env.INTERNAL_JOB_SECRET!,
          },
          oidcToken: {
            serviceAccountEmail: process.env.CLOUD_TASKS_SERVICE_ACCOUNT!,
            audience: base,
          },
          body: Buffer.from(
            JSON.stringify({
              uid: job.userId,
              projectId: job.projectId,
              jobId: job.id,
            }),
          ).toString("base64"),
        },
      },
    });
  } catch (e) {
    if ((e as { code?: number }).code !== 6) throw e;
  }
  await projectRef(job.userId, job.projectId)
    .collection("jobs")
    .doc(job.id)
    .update({ dispatched: true, updatedAt: new Date().toISOString() });
}
