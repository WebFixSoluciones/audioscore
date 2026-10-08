import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ result: "", calls: [] as unknown[][] }));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(async () => {}) }));
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => {
    state.calls.push(args);
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from(state.result));
      child.emit("close", 0);
    });
    return child;
  },
}));
import { separateLocalAudio } from "@/lib/audio/separation";
const manifest = () => ({
  model: "htdemucs_6s",
  durationSeconds: 12,
  gain: 1,
  warnings: [],
  sources: [
    {
      id: "demucs-piano",
      kind: "piano",
      label: "Piano",
      file: "piano.wav",
      confidence: 0,
      rms: 0.1,
      transcriptionEligible: true,
    },
  ],
});
beforeEach(() => {
  vi.unstubAllEnvs();
  state.calls = [];
  state.result = JSON.stringify(manifest());
});
describe("offline separator contract", () => {
  it("uses an isolated Python process and resolves filenames inside its output folder", async () => {
    vi.stubEnv("PYTHON_PATH", "test-python");
    const result = await separateLocalAudio("normalized.wav", 6);
    expect(state.calls[0][0]).toBe("test-python");
    expect(state.calls[0][1]).toContain("htdemucs_6s");
    expect(result.sources[0].localPath).toMatch(/separated[\\/]piano.wav$/);
    expect(result.sources[0].confidence).toBe(0);
  });
  it("selects four categories for a four-source plan rather than claiming six stems", async () => {
    await separateLocalAudio("normalized.wav", 4);
    expect(state.calls[0][1]).toContain("htdemucs");
    expect(state.calls[0][1]).not.toContain("htdemucs_6s");
  });
  it("rejects Vercel execution and insufficient plans before spawning a process", async () => {
    vi.stubEnv("VERCEL", "1");
    await expect(separateLocalAudio("normalized.wav", 6)).rejects.toThrow(
      "fuera de Vercel",
    );
    vi.stubEnv("VERCEL", "");
    await expect(separateLocalAudio("normalized.wav", 2)).rejects.toThrow(
      "cuatro fuentes",
    );
    expect(state.calls).toHaveLength(0);
  });
  it("rejects traversing filenames and duplicate source IDs", async () => {
    const invalid = manifest();
    invalid.sources[0].file = "../piano.wav";
    state.result = JSON.stringify(invalid);
    await expect(separateLocalAudio("normalized.wav", 6)).rejects.toThrow();
    const duplicated = manifest();
    duplicated.sources.push(duplicated.sources[0]);
    state.result = JSON.stringify(duplicated);
    await expect(separateLocalAudio("normalized.wav", 6)).rejects.toThrow(
      "duplicadas",
    );
  });
});
