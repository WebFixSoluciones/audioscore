import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const records = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("@/lib/firebase/admin", () => ({
  adminFirebase: () => ({
    db: {
      doc: (path: string) => ({ path }),
      runTransaction: async (work: (tx: unknown) => Promise<void>) =>
        work({
          get: async (ref: { path: string }) => ({
            data: () => records.get(ref.path),
          }),
          set: (ref: { path: string }, value: Record<string, unknown>) =>
            records.set(ref.path, value),
        }),
    },
  }),
}));
import { rateLimit } from "@/lib/security/rate-limit";
beforeEach(() => {
  records.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:01Z"));
});
afterEach(() => vi.useRealTimers());
describe("control de solicitudes en el plan gratuito", () => {
  it("rechaza el exceso y reinicia el contador sin acumular documentos cada minuto", async () => {
    await rateLimit("owner", "projects-POST", 2);
    await rateLimit("owner", "projects-POST", 2);
    await expect(rateLimit("owner", "projects-POST", 2)).rejects.toThrow(
      "Demasiadas solicitudes",
    );
    vi.setSystemTime(new Date("2026-10-06T12:01:01Z"));
    await expect(
      rateLimit("owner", "projects-POST", 2),
    ).resolves.toBeUndefined();
    expect(records.size).toBe(1);
  });
  it("mantiene independientes los límites de usuarios y operaciones", async () => {
    await rateLimit("owner", "projects-POST", 1);
    await expect(
      rateLimit("other", "projects-POST", 1),
    ).resolves.toBeUndefined();
    await expect(
      rateLimit("owner", "projects-GET", 1),
    ).resolves.toBeUndefined();
    await expect(rateLimit("owner", "projects-POST", 1)).rejects.toThrow();
  });
});
