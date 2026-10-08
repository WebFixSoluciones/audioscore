import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  options: {} as Record<string, unknown>,
  tasks: [] as unknown[],
  federated: undefined as unknown,
}));
vi.mock("@/lib/firebase/federation", () => ({
  federatedFirebase: () =>
    state.federated ? { authClient: state.federated } : undefined,
}));
vi.mock("@google-cloud/tasks", () => ({
  CloudTasksClient: class {
    constructor(options: Record<string, unknown>) {
      state.options = options;
    }
    queuePath(project: string, location: string, queue: string) {
      return `${project}/${location}/${queue}`;
    }
    async createTask(task: unknown) {
      state.tasks.push(task);
    }
  },
}));
vi.mock("@/lib/security/ownership", () => ({
  projectRef: () => ({
    collection: () => ({ doc: () => ({ update: async () => {} }) }),
  }),
}));
import { enqueue } from "../lib/jobs/queue";
import type { Job } from "../lib/billing/reservations";
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  state.options = {};
  state.tasks = [];
  state.federated = undefined;
});
it("reuses Vercel workload identity for Cloud Tasks without requiring a private key", async () => {
  for (const [name, value] of Object.entries({
    CLOUD_TASKS_QUEUE: "audio",
    CLOUD_TASKS_LOCATION: "test-location",
    GOOGLE_CLOUD_PROJECT_ID: "test-project",
    CLOUD_TASKS_SERVICE_ACCOUNT: "worker@example.test",
    WORKER_URL: "https://worker.example.test",
    INTERNAL_JOB_SECRET: "test-secret-not-a-real-secret-123456",
  }))
    vi.stubEnv(name, value);
  state.federated = { kind: "verified-federated-client" };
  await enqueue({
    id: "job-identity",
    userId: "owner",
    projectId: "project-1",
  } as Job);
  expect(state.options.authClient).toBe(state.federated);
  expect(state.options.credentials).toBeUndefined();
});
describe("Vercel deployment configuration", () => {
  it("keeps public browser models but excludes worker runtime from web function tracing", async () => {
    vi.stubEnv("VERCEL", "1");
    const { default: config } = await import("../next.config");
    expect(config.output).toBeUndefined();
    expect(config.outputFileTracingExcludes?.["/api/*"]).toContain(
      "./runtime/**",
    );
    expect(config.outputFileTracingExcludes?.["/api/*"]).toContain(
      "./public/models/**",
    );
    expect(config.outputFileTracingIncludes?.["/api/*"]).toContain(
      "./node_modules/pdfkit/js/data/**/*",
    );
    expect(config.outputFileTracingIncludes?.["/api/*"]).not.toContain(
      "./runtime/transcription-worker.cjs",
    );
  });
  it("retains the standalone worker configuration outside Vercel", async () => {
    vi.stubEnv("VERCEL", "");
    const { default: config } = await import("../next.config");
    expect(config.output).toBe("standalone");
    expect(config.outputFileTracingIncludes?.["/api/*"]).toContain(
      "./runtime/transcription-worker.cjs",
    );
  });
  it("authenticates Cloud Tasks explicitly when web credentials are configured", async () => {
    for (const [name, value] of Object.entries({
      CLOUD_TASKS_QUEUE: "audio",
      CLOUD_TASKS_LOCATION: "test-location",
      GOOGLE_CLOUD_PROJECT_ID: "test-project",
      CLOUD_TASKS_SERVICE_ACCOUNT: "worker@example.test",
      WORKER_URL: "https://worker.example.test",
      INTERNAL_JOB_SECRET: "test-secret-not-a-real-secret-123456",
      FIREBASE_CLIENT_EMAIL: "web@example.test",
      FIREBASE_PRIVATE_KEY: "test\\nkey",
    }))
      vi.stubEnv(name, value);
    await enqueue({
      id: "job-1",
      userId: "owner",
      projectId: "project-1",
    } as Job);
    expect(state.options).toEqual({
      projectId: "test-project",
      credentials: {
        client_email: "web@example.test",
        private_key: "test\nkey",
      },
    });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({
      task: {
        httpRequest: {
          url: "https://worker.example.test/api/internal/jobs/process",
        },
      },
    });
  });
});
