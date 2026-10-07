import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultPlan } from "@/lib/billing/plans";
const memory = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  lock: Promise.resolve(),
}));
vi.mock("@/lib/firebase/admin", () => {
  type Ref = {
    path: string;
    collection: (name: string) => { doc: (id: string) => Ref };
  };
  const ref = (path: string): Ref => ({
    path,
    collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
  });
  const snap = (r: { path: string }) => ({
    exists: memory.docs.has(r.path),
    data: () => structuredClone(memory.docs.get(r.path)),
  });
  return {
    adminFirebase: () => ({
      db: {
        doc: ref,
        runTransaction: async (work: (tx: unknown) => Promise<unknown>) => {
          const prior = memory.lock;
          let release!: () => void;
          memory.lock = new Promise((resolve) => {
            release = resolve;
          });
          await prior;
          const writes: (() => void)[] = [];
          const tx = {
            getAll: async (...refs: { path: string }[]) => refs.map(snap),
            set: (
              r: { path: string },
              d: Record<string, unknown>,
              options?: { merge?: boolean },
            ) =>
              writes.push(() =>
                memory.docs.set(
                  r.path,
                  options?.merge ? { ...memory.docs.get(r.path), ...d } : d,
                ),
              ),
            update: (r: { path: string }, d: Record<string, unknown>) =>
              writes.push(() =>
                memory.docs.set(r.path, { ...memory.docs.get(r.path), ...d }),
              ),
          };
          try {
            const result = await work(tx);
            writes.forEach((w) => w());
            return result;
          } finally {
            release();
          }
        },
      },
    }),
  };
});
import { reserveJob, finishJob, type Job } from "@/lib/billing/reservations";
function leaseJob(job: Job) {
  job.status = "running";
  job.leaseToken = "worker-token";
  memory.docs.set(
    `users/${job.userId}/projects/${job.projectId}/jobs/${job.id}`,
    { ...job },
  );
}
beforeEach(() => {
  memory.docs.clear();
  memory.lock = Promise.resolve();
  memory.docs.set("users/u1", {
    status: "active",
    planId: "free",
    subscriptionStatus: "active",
    activeJobs: 0,
  });
  memory.docs.set("users/u1/projects/p1", {
    userId: "u1",
    status: "uploaded",
    storagePath: "temporary/u1/p1/audio.wav",
    durationSeconds: 60,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  memory.docs.set("users/u1/projects/p2", {
    userId: "u1",
    status: "uploaded",
    storagePath: "temporary/u1/p2/audio.wav",
    durationSeconds: 60,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
});
describe("reservas atómicas", () => {
  it("dos solicitudes iguales producen un trabajo y una reserva", async () => {
    const results = await Promise.all([
      reserveJob("u1", "p1", "request-0001", getDefaultPlan("free"), {
        kind: "analysis",
      }),
      reserveJob("u1", "p1", "request-0001", getDefaultPlan("free"), {
        kind: "analysis",
      }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(memory.docs.get("users/u1")?.activeJobs).toBe(1);
    expect(
      [...memory.docs.values()].filter((d) => d.status === "reserved"),
    ).toHaveLength(1);
  });
  it("dos proyectos concurrentes no exceden el límite", async () => {
    const results = await Promise.allSettled([
      reserveJob("u1", "p1", "request-0001", getDefaultPlan("free"), {
        kind: "analysis",
      }),
      reserveJob("u1", "p2", "request-0002", getDefaultPlan("free"), {
        kind: "analysis",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("confirmar dos veces cobra una vez", async () => {
    const job = await reserveJob(
      "u1",
      "p1",
      "request-0001",
      getDefaultPlan("free"),
      { kind: "analysis" },
    );
    leaseJob(job);
    await finishJob(job, "completed");
    await finishJob(job, "completed");
    expect(
      memory.docs.get(`users/u1/usageMonths/${job.month}`)?.minutesUsed,
    ).toBe(1);
    expect(
      memory.docs.get(`users/u1/usageMonths/${job.month}`)?.minutesReserved,
    ).toBe(0);
    expect(memory.docs.get("users/u1")?.activeJobs).toBe(0);
  });
  it("cancelar libera minutos y no permite una confirmación tardía", async () => {
    const job = await reserveJob(
      "u1",
      "p1",
      "request-0001",
      getDefaultPlan("free"),
      { kind: "analysis" },
    );
    await finishJob(job, "cancelled");
    await finishJob(job, "completed");
    expect(
      memory.docs.get(`users/u1/usageMonths/${job.month}`)?.minutesUsed,
    ).toBe(0);
    expect(memory.docs.get(`users/u1/usage/${job.id}`)?.status).toBe(
      "released",
    );
  });
  it("rechaza reutilizar una clave con otra región", async () => {
    await reserveJob("u1", "p1", "request-0001", getDefaultPlan("free"), {
      kind: "analysis",
    });
    await expect(
      reserveJob("u1", "p1", "request-0001", getDefaultPlan("free"), {
        kind: "analysis",
        region: [0, 10],
      }),
    ).rejects.toThrow("otra solicitud");
  });
});
