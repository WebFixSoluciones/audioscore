import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeOnMachine, waitForMachineJob } from "@/lib/audio/local/client";
import { fixture } from "./fixtures";
const response = (data: unknown, status = 200) =>
  Response.json(data, { status });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("local job recovery and cancellation", () => {
  it("retries a temporary outage without uploading or starting the analysis again", async () => {
    vi.useFakeTimers();
    const result = {
      document: fixture(),
      urls: {},
      originalUrl: "original.wav",
      peaks: [],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ job: { id: "job" } }, 202))
      .mockResolvedValueOnce(response({ error: "Iniciando motor" }, 503))
      .mockResolvedValueOnce(
        response({
          job: { status: "completed", progress: 100, stage: "Completado" },
        }),
      )
      .mockResolvedValueOnce(response(result));
    vi.stubGlobal("fetch", fetch);
    const work = analyzeOnMachine(
      new File(["audio"], "fixture.wav", { type: "audio/wav" }),
      vi.fn(),
      new AbortController().signal,
      vi.fn(),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await work).toEqual(result);
    expect(
      fetch.mock.calls.filter(([, options]) => options.method === "POST"),
    ).toHaveLength(1);
  });
  it("cancels the existing job while waiting between progress reads", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({
          job: { status: "running", progress: 20, stage: "Separando" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const work = waitForMachineJob("job", vi.fn(), controller.signal);
    const rejected = expect(work).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(20);
    controller.abort();
    await rejected;
    expect(
      fetch.mock.calls.some(([, options]) => options.method === "DELETE"),
    ).toBe(true);
  });
});
