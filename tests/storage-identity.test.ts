import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  options: {} as Record<string, unknown>,
  auth: { kind: "federated-client" },
}));
vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    constructor(options: Record<string, unknown>) {
      state.options = options;
    }
    bucket(name: string) {
      return { name };
    }
  },
}));
vi.mock("@/lib/firebase/federation", () => ({
  federationOptions: () => state.auth,
}));
vi.mock("@/lib/firebase/admin", () => ({ adminFirebase: vi.fn() }));
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  state.options = {};
});
it("uses the existing federated identity for temporary Storage on Vercel", async () => {
  vi.stubEnv("GOOGLE_CLOUD_STORAGE_BUCKET", "test-bucket");
  const { temporaryBucket } = await import("@/lib/firebase/storage");
  temporaryBucket();
  expect(state.options.credentials).toBe(state.auth);
  expect(state.options.authClient).toBeUndefined();
});
it("keeps explicit private credentials as an optional alternative", async () => {
  vi.stubEnv("GOOGLE_CLOUD_STORAGE_BUCKET", "test-bucket");
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "test@example.test");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "test\\nkey");
  const { temporaryBucket } = await import("@/lib/firebase/storage");
  temporaryBucket();
  expect(state.options.credentials).toEqual({
    client_email: "test@example.test",
    private_key: "test\nkey",
  });
  expect(state.options.authClient).toBeUndefined();
});
