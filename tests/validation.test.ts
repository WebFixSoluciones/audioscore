import { describe, it, expect } from "vitest";
import { validateAudioFile } from "@/lib/audio/audio-validation";
import { getDefaultPlan, checkQuota } from "@/lib/billing/plans";
import { idempotencyId } from "@/lib/jobs/idempotency";
import { assertStorageOwner } from "@/lib/firebase/storage";
describe("archivo, plan y propiedad", () => {
  it("acepta un WAV y rechaza MIME incoherente, vacío o demasiado grande", () => {
    expect(validateAudioFile("song.wav", "audio/wav", 1000)).toBe("wav");
    expect(() => validateAudioFile("song.exe", "audio/wav", 1000)).toThrow();
    expect(() => validateAudioFile("song.wav", "audio/mpeg", 1000)).toThrow();
    expect(() => validateAudioFile("song.wav", "audio/wav", 0)).toThrow();
    expect(() =>
      validateAudioFile("song.wav", "audio/wav", 500000000),
    ).toThrow();
  });
  it("respeta minutos reservados, duración y concurrencia", () => {
    const p = getDefaultPlan("free");
    expect(() => checkQuota(p, 60, 8, 1, 0)).not.toThrow();
    expect(() => checkQuota(p, 61, 8, 1, 0)).toThrow();
    expect(() => checkQuota(p, 121, 0, 0, 0)).toThrow();
    expect(() => checkQuota(p, 60, 0, 0, 1)).toThrow();
    expect(() => checkQuota(p, NaN, 0, 0, 0)).toThrow();
  });
  it("no mezcla claves entre usuarios ni proyectos", () => {
    const a = idempotencyId("u1", "p1", "request-001", "analysis");
    expect(a).toBe(idempotencyId("u1", "p1", "request-001", "analysis"));
    expect(a).not.toBe(idempotencyId("u2", "p1", "request-001", "analysis"));
    expect(() => idempotencyId("u1", "p1", "x", "analysis")).toThrow();
  });
  it("rechaza archivos ajenos y rutas de traversal", () => {
    expect(() =>
      assertStorageOwner("temporary/u1/p1/source.wav", "u1", "p1"),
    ).not.toThrow();
    expect(() =>
      assertStorageOwner("temporary/u2/p1/source.wav", "u1", "p1"),
    ).toThrow();
    expect(() =>
      assertStorageOwner("temporary/u1/p1/../x", "u1", "p1"),
    ).toThrow();
  });
});
