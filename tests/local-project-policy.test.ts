import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { fixture } from "./fixtures";
const token = randomUUID() + randomUUID();
const testRoot = resolve(".tmp", `project-policy-${randomUUID()}`);
const ids = {
  draft: randomUUID(),
  saved: randomUUID(),
  bob: randomUUID(),
  legacy: randomUUID(),
};
let worker: ChildProcess,
  port: number,
  logs = "";
const document = fixture();
document.sources[0].id = "demucs-piano";
document.events.forEach((event) => {
  event.sourceId = "demucs-piano";
});
async function start() {
  worker = spawn(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "services/local/server.ts",
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        VERCEL: "",
        LOCAL_AUDIO_TOKEN: token,
        LOCAL_AUDIO_PORT: String(port),
        LOCAL_AUDIO_ROOT: testRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  worker.stderr?.on("data", (data) => {
    logs = (logs + data.toString()).slice(-3000);
  });
  for (let attempt = 0; attempt < 600; attempt++) {
    if (worker.exitCode !== null)
      throw new Error(`Local test server stopped: ${logs}`);
    try {
      if (
        (
          await fetch(`http://127.0.0.1:${port}/health`, {
            headers: { "x-local-token": token },
          })
        ).ok
      )
        return;
    } catch {
      /* Wait for imports. */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Local test server did not start: ${logs}`);
}
async function stop() {
  if (!worker || worker.exitCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    worker.once("exit", () => resolve()),
  );
  worker.kill();
  await exited;
}
async function request(path: string, uid = "alice", options: RequestInit = {}) {
  return fetch(`http://127.0.0.1:${port}/${path}`, {
    ...options,
    headers: {
      "x-local-token": token,
      "x-local-user": uid,
      "content-type": "application/json",
    },
  });
}
beforeAll(async () => {
  port = await new Promise<number>((resolvePort) => {
    const net = createServer();
    net.listen(0, "127.0.0.1", () => {
      const address = net.address() as { port: number };
      net.close(() => resolvePort(address.port));
    });
  });
  for (const [kind, id] of Object.entries(ids)) {
    const dir = join(testRoot, id);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "job.json"),
      JSON.stringify({
        id,
        title: kind,
        status: "completed",
        progress: 100,
        stage: "Completado",
        createdAt: new Date().toISOString(),
        ...(kind !== "legacy"
          ? { ownerUid: kind === "bob" ? "bob" : "alice" }
          : {}),
        ...(kind === "saved" || kind === "bob" || kind === "legacy"
          ? { savedAt: new Date().toISOString() }
          : {}),
      }),
    );
    await writeFile(join(dir, "original.wav"), "fixture-audio");
    await writeFile(
      join(dir, "result.json"),
      JSON.stringify({
        document,
        urls: { "demucs-piano": `/api/local/jobs/${id}/files/piano.wav` },
        originalUrl: `/api/local/jobs/${id}/files/original.wav`,
        peaks: [0.2, 0.5],
      }),
    );
  }
  await start();
}, 90000);
afterAll(async () => {
  await stop();
  if (!testRoot.startsWith(resolve(".tmp") + sep))
    throw new Error("Unsafe test cleanup path");
  await rm(testRoot, { recursive: true, force: true });
});
describe("explicit local projects and per-user access", () => {
  it("shows only saved projects owned by the signed-in user", async () => {
    const { jobs } = await (await request("jobs")).json();
    expect(jobs.map((job: { id: string }) => job.id)).toEqual([ids.saved]);
    expect((await (await request("jobs", "charlie")).json()).jobs).toEqual([]);
    expect((await request("jobs", "")).status).toBe(401);
    expect(
      (
        await fetch(`http://127.0.0.1:${port}/jobs`, {
          headers: { "x-local-user": "alice" },
        })
      ).status,
    ).toBe(403);
  });
  it("does not expose another user's result, audio or project even with a known id", async () => {
    for (const suffix of ["", "/result", "/project", "/files/original.wav"])
      expect((await request(`jobs/${ids.bob}${suffix}`)).status).toBe(404);
    expect(
      (
        await request(`jobs/${ids.bob}/project`, "alice", {
          method: "POST",
          body: JSON.stringify({ document }),
        })
      ).status,
    ).toBe(404);
    expect((await request(`jobs/${ids.legacy}/result`)).status).toBe(404);
  });
  it("keeps an analysis temporary until explicit save, persists notes and mix, and survives restart", async () => {
    expect((await request(`jobs/${ids.draft}/result`)).ok).toBe(true);
    expect((await request(`jobs/${ids.draft}/project`)).status).toBe(409);
    const savedDocument = { ...document, title: "Proyecto que elegí guardar" };
    const mix = {
      "demucs-piano": { volume: 0.4, pan: -0.2, muted: false, solo: true },
    };
    const saved = await request(`jobs/${ids.draft}/project`, "alice", {
      method: "POST",
      body: JSON.stringify({ document: savedDocument, mix }),
    });
    expect(saved.ok).toBe(true);
    const result = await (await request(`jobs/${ids.draft}/project`)).json();
    expect(result.job.savedAt).toBeTruthy();
    expect(result.result.document.title).toBe(savedDocument.title);
    expect(result.result.mix).toEqual(mix);
    expect(
      await readFile(join(testRoot, ids.draft, "score.musicxml"), "utf8"),
    ).toContain("score-partwise");
    expect(
      (await readFile(join(testRoot, ids.draft, "score.mid"))).toString(
        "ascii",
        0,
        4,
      ),
    ).toBe("MThd");
    await stop();
    await start();
    const { jobs } = await (await request("jobs")).json();
    expect(jobs.map((job: { id: string }) => job.id)).toContain(ids.draft);
    expect(
      (await (await request("jobs", "bob")).json()).jobs.map(
        (job: { id: string }) => job.id,
      ),
    ).toEqual([ids.bob]);
  }, 90000);
});
