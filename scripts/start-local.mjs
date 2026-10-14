import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { availableParallelism, cpus } from "node:os";
const python = resolve(
  process.platform === "win32"
    ? ".tmp/separator-venv/Scripts/python.exe"
    : ".tmp/separator-venv/bin/python",
);
try {
  await access(python);
} catch {
  console.error("Falta el entorno Python. Ejecuta npm run local:setup.");
  process.exit(1);
}
const env = {
  ...process.env,
  LOCAL_AUDIO_ENABLED: "1",
  LOCAL_AUDIO_TOKEN: randomBytes(32).toString("hex"),
  PYTHON_PATH: python,
  SEPARATION_ENGINE: "demucs",
  NEXT_PUBLIC_APP_URL: "http://audioscore.localhost:3000",
  VERCEL: "",
  DEMUCS_THREADS: String(Math.max(1, availableParallelism?.() || cpus?.()?.length || 4)),
};
const worker = spawn(
  process.execPath,
  ["--conditions=react-server", "--import", "tsx", "services/local/server.ts"],
  { stdio: "inherit", windowsHide: true, env },
);
let web;
let stopping = false;
function stopChild(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else child.kill();
}
function stop() {
  if (stopping) return;
  stopping = true;
  stopChild(worker);
  stopChild(web);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
worker.once("error", stop);
worker.once("exit", (code) => {
  stop();
  process.exitCode = code || 0;
});
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch("http://127.0.0.1:8765/health", {
      headers: { "x-local-token": env.LOCAL_AUDIO_TOKEN },
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* Wait for the private service to start. */
  }
  if (stopping) break;
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  console.error("No se pudo iniciar el motor local.");
  stop();
  process.exitCode = 1;
} else {
  web = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ],
    { stdio: "inherit", windowsHide: true, env },
  );
  web.once("error", stop);
  web.once("exit", (code) => {
    stop();
    process.exitCode = code || 0;
  });
  console.log(
    "AudioScore local: http://audioscore.localhost:3000/studio (alternativa http://localhost:3000/studio)",
  );
}
