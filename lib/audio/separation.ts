import "server-only";
import { spawn } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "@/lib/utils/errors";

export const stemKindSchema = z.enum([
  "piano",
  "guitar",
  "bass",
  "drums",
  "vocals",
  "other",
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
};
const manifestSchema = z.object({
  model: z.enum(["htdemucs", "htdemucs_6s"]),
  durationSeconds: z.number().positive().max(900),
  gain: z.number().positive().max(1),
  warnings: z.array(z.string().max(500)).max(100),
  sources: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
        kind: stemKindSchema,
        label: z.string().max(120),
        file: z.string().regex(/^[a-z]+\.wav$/),
        confidence: z.literal(0),
        rms: z.number().finite().positive(),
        transcriptionEligible: z.boolean(),
      }),
    )
    .min(1)
    .max(6),
});

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
