import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "@/lib/utils/errors";
import type { AudioAssetMetadata, StageTelemetry } from "./iatpe/types";

export const stemKindSchema = z.enum([
  "piano",
  "guitar",
  "bass",
  "drums",
  "vocals",
  "other",
  "percussion",
  "sound_fx",
  "unknown",
]);
export type StemKind = z.infer<typeof stemKindSchema>;
export type SeparatedStem = {
  id: string;
  kind: StemKind;
  label: string;
  confidence: number;
  storagePath: string;
  localPath: string;
  transcriptionEligible?: boolean;
  level?: number;
  parentStem?: string;
  program?: number;
  family?: string;
};
const manifestSchema = z.object({
  model: z.enum([
    "htdemucs",
    "htdemucs_6s",
    "bs_roformer",
    "mel_band_roformer",
    "iatpe_ensemble",
  ]),
  durationSeconds: z.number().positive().max(900),
  gain: z.number().positive().max(1),
  warnings: z.array(z.string().max(500)).max(100),
  sources: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
        kind: stemKindSchema,
        label: z.string().max(120),
        file: z.string().regex(/^[a-z0-9_-]+\.wav$/),
        confidence: z.number().min(0).max(1),
        rms: z.number().finite().positive(),
        transcriptionEligible: z.boolean(),
        level: z.number().int().min(1).max(3).optional(),
        parentStem: z.string().optional(),
      }),
    )
    .min(1)
    .max(64),
});
export { manifestSchema as separationManifestSchema };

export function separationEnabled() {
  return (
    process.env.SEPARATION_ENGINE === "demucs" ||
    !!process.env.SEPARATION_PROVIDER_URL
  );
}

export async function separateLocalAudio(
  input: string,
  maxSources: number,
  timeoutMs = 15 * 60000,
) {
  if (process.env.VERCEL === "1")
    throw new ApiError(
      503,
      "La separación se ejecuta en el worker de audio, fuera de Vercel.",
    );
  if (maxSources < 4)
    throw new ApiError(
      403,
      "Demucs requiere un plan que admita al menos cuatro fuentes.",
    );
  const output = resolve(dirname(input), "separated");
  await mkdir(output, { recursive: true });
  const model =
    maxSources >= 6 && process.env.DEMUCS_MODEL !== "htdemucs"
      ? "htdemucs_6s"
      : "htdemucs";
  const stdout = await new Promise<string>((resolveOutput, reject) => {
    const child = spawn(
      process.env.PYTHON_PATH || "python3",
      [
        join(process.cwd(), "services/separator/separate.py"),
        "--input",
        input,
        "--output",
        output,
        "--model",
        model,
        "--device",
        process.env.DEMUCS_DEVICE === "cuda" ? "cuda" : "cpu",
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUTF8: "1" },
      },
    );
    let result = "",
      stderr = "",
      settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        reject(error);
      } else resolveOutput(result);
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "La separación superó el tiempo disponible. Usa un audio más corto.",
          ),
        ),
      timeoutMs,
    );
    child.stdout.on("data", (bytes: Buffer) => {
      result += bytes.toString();
      if (result.length > 100000)
        finish(new Error("Manifest de separación demasiado grande"));
    });
    child.stderr.on("data", (bytes: Buffer) => {
      stderr = (stderr + bytes.toString()).slice(-4000);
    });
    child.once("error", () =>
      finish(
        new Error("Python/Demucs no está disponible en el worker de audio."),
      ),
    );
    child.once("close", (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(`Separación Demucs fallida: ${stderr.slice(-1000)}`),
      ),
    );
  });
  const manifest = manifestSchema.parse(JSON.parse(stdout));
  if (
    new Set(manifest.sources.map((s) => s.id)).size !==
      manifest.sources.length ||
    manifest.sources.length > maxSources
  )
    throw new Error(
      "Manifest de separación con fuentes duplicadas o fuera del plan",
    );
  return {
    ...manifest,
    sources: manifest.sources.map((source) => ({
      ...source,
      localPath: join(output, source.file),
    })),
  };
}

export interface SeparationJobOptions {
  inputPath: string;
  outputDir: string;
  model: "htdemucs" | "htdemucs_6s" | "bs_roformer" | "mel_band_roformer" | "iatpe_ensemble";
  quality?: "balanced" | "careful";
  device?: "cpu" | "cuda";
  hierarchicalPlan?: Record<string, unknown>;
  signal?: AbortSignal;
  onStemReady?: (stem: AudioAssetMetadata) => void;
}

export interface SeparationJobResult {
  model: string;
  engine: string;
  durationSeconds: number;
  gain: number;
  sources: AudioAssetMetadata[];
  warnings: string[];
  telemetry: StageTelemetry;
}

const separationResultCache = new Map<string, SeparationJobResult>();
const inFlightSeparationJobs = new Map<string, Promise<SeparationJobResult>>();

export async function computeFileSha256(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

export function buildSeparationCacheKey(
  audioSha256: string,
  model: string,
  quality: string,
  plan?: Record<string, unknown>
): string {
  const payload = JSON.stringify({ audioSha256, model, quality, plan: plan ?? null });
  return createHash("sha256").update(payload).digest("hex");
}

export async function runAudioSeparation(options: SeparationJobOptions): Promise<SeparationJobResult> {
  if (process.env.VERCEL === "1" && !process.env.SEPARATION_PROVIDER_URL) {
    throw new Error("La separación se ejecuta en el worker de audio, fuera de Vercel");
  }

if (options.signal?.aborted) {
    throw new Error("Trabajo de separación cancelado antes de iniciar");
  }

const quality = options.quality ?? "balanced";
  const device = options.device ?? "cpu";
  const audioSha256 = await computeFileSha256(options.inputPath);
  const cacheKey = buildSeparationCacheKey(audioSha256, options.model, quality, options.hierarchicalPlan);

// 1. Warm Cache Hit (Delivery 4)
  const cached = separationResultCache.get(cacheKey);
  if (cached) {
    for (const stem of cached.sources) {
      options.onStemReady?.(stem);
    }
    return {
      ...cached,
      telemetry: {
        ...cached.telemetry,
        cacheHit: true,
        coalescedInFlight: false,
      },
    };
  }

// 2. In-Flight Job Coalescing (Delivery 4)
  const existingInFlight = inFlightSeparationJobs.get(cacheKey);
  if (existingInFlight) {
    const sharedResult = await existingInFlight;
    return {
      ...sharedResult,
      telemetry: {
        ...sharedResult.telemetry,
        coalescedInFlight: true,
      },
    };
  }

const jobPromise = executePythonSeparationProcess({
    ...options,
    quality,
    device,
  }).then((res) => {
    separationResultCache.set(cacheKey, res);
    inFlightSeparationJobs.delete(cacheKey);
    return res;
  }).catch((err) => {
    inFlightSeparationJobs.delete(cacheKey);
    throw err;
  });

inFlightSeparationJobs.set(cacheKey, jobPromise);
  return jobPromise;
}

async function executePythonSeparationProcess(
  options: Required<Pick<SeparationJobOptions, "inputPath" | "outputDir" | "model" | "quality" | "device">> &
    Pick<SeparationJobOptions, "hierarchicalPlan" | "signal" | "onStemReady">
): Promise<SeparationJobResult> {
  return new Promise<SeparationJobResult>((resolve, reject) => {
    const scriptPath = path.resolve(process.cwd(), "services/separator/separate.py");
    const args = [
      scriptPath,
      "--input",
      options.inputPath,
      "--output",
      options.outputDir,
      "--model",
      options.model === "htdemucs" ? "htdemucs" : "htdemucs_6s",
      "--device",
      options.device,
      "--quality",
      options.quality,
    ];
    if (options.hierarchicalPlan) {
      args.push("--plan", JSON.stringify(options.hierarchicalPlan));
    }

const pyCmd = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
    const child: ChildProcess = spawn(pyCmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

const cleanupAndAbort = () => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("Separación cancelada por el usuario; proceso Python y recursos liberados."));
    };

if (options.signal) {
      options.signal.addEventListener("abort", cleanupAndAbort, { once: true });
    }

child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf-8");
    });

child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stderrBuffer += text;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.event === "stem_ready" && parsed.stem && options.onStemReady) {
            options.onStemReady(parsed.stem as AudioAssetMetadata);
          }
        } catch {
          // Non-JSON diagnostic line on stderr
        }
      }
    });

    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", cleanupAndAbort);
      reject(err);
    });

    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", cleanupAndAbort);
      if (code !== 0) {
        reject(new Error(`Error en worker de separación (código ${code}): ${stderrBuffer.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdoutBuffer.trim()) as SeparationJobResult;
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Salida JSON inválida del separador: ${(err as Error).message}`));
      }
    });
  });
}
