import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

let worker: ChildProcessWithoutNullStreams | undefined;
let pending:
  | {
      id: string;
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
  | undefined;
let stderr = "";
export function stopPython() {
  const active = worker;
  worker = undefined;
  if (!active?.pid) return;
  if (process.platform === "win32") {
    // A Windows venv launcher starts a child Python process; cancellation must stop both.
    spawn("taskkill", ["/PID", String(active.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    }).on("error", () => active.kill());
  } else active.kill();
}
export async function pythonRequest(
  input: Record<string, string>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (pending) throw new Error("El motor Python está ocupado.");
  if (!worker) {
    worker = spawn(
      process.env.PYTHON_PATH!,
      [join(process.cwd(), "services/separator/local_engine.py")],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUTF8: "1", NUMBA_NUM_THREADS: "2" },
      },
    );
    stderr = "";
    const active = worker;
    active.stderr.on("data", (bytes: Buffer) => {
      stderr = (stderr + bytes.toString()).slice(-3000);
    });
    createInterface({ input: active.stdout }).on("line", (line) => {
      if (line.length > 1_000_000) {
        pending?.reject(new Error("Respuesta Python demasiado grande"));
        stopPython();
        return;
      }
      try {
        const response = JSON.parse(line);
        if (response.id !== pending?.id) return;
        if (response.error) pending?.reject(new Error(String(response.error)));
        else pending?.resolve(response.result);
      } catch {
        pending?.reject(new Error("Respuesta inválida del motor Python"));
        stopPython();
      }
    });
    active.once("error", () => {
      pending?.reject(
        new Error("Python no está disponible. Ejecuta npm run local:setup."),
      );
      if (worker === active) worker = undefined;
    });
    active.once("exit", () => {
      if (worker !== active) return;
      worker = undefined;
      pending?.reject(
        new Error(`El motor Python terminó: ${stderr.slice(-800)}`),
      );
    });
  }
  const id = randomUUID();
  const abort = () => {
    pending?.reject(new DOMException("Análisis cancelado", "AbortError"));
    stopPython();
  };
  const timer = setTimeout(() => {
    pending?.reject(
      new Error(
        "El motor Python superó 20 minutos. Prueba un audio más corto.",
      ),
    );
    stopPython();
  }, 20 * 60000);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      pending = { id, resolve, reject };
      signal.addEventListener("abort", abort, { once: true });
      worker!.stdin.write(JSON.stringify({ ...input, id }) + "\n");
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    pending = undefined;
  }
}
