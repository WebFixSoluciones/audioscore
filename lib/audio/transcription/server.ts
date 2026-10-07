import "server-only";
import { Worker } from "node:worker_threads";
import { join, dirname, sep } from "node:path";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { transcriptionDocument } from "./document";
import type { MusicDocument } from "@/lib/music/types";
import type {
  TranscriptionProgress,
  TranscriptionResult,
  TranscriptionWorkerMessage,
} from "./types";

export async function transcribeLocalAudio(
  input: string,
  title: string,
  options: {
    sourceId?: string;
    tempoMap?: MusicDocument["tempoMap"];
    onProgress?: (value: TranscriptionProgress) => Promise<void>;
  } = {},
) {
  const pcmPath = join(dirname(input), "transcription.pcm");
  const executable = process.env.FFMPEG_PATH || ffmpegStatic;
  if (!executable) throw new Error("FFmpeg no está disponible.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "-y",
        "-v",
        "error",
        "-i",
        input,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "22050",
        "-t",
        "901",
        "-f",
        "f32le",
        pcmPath,
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Timeout preparando audio para transcripción"));
    }, 120000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(new Error("No se pudo preparar el audio para transcripción."));
    });
  });
  const wasmDirectory = join(process.cwd(), "public/models/tfjs") + sep;
  const result = await new Promise<TranscriptionResult>((resolve, reject) => {
    const worker = new Worker(
      join(process.cwd(), "runtime/transcription-worker.cjs"),
      {
        execArgv: [],
        workerData: {
          pcmPath,
          modelsDirectory: join(process.cwd(), "public/models"),
          wasmDirectory,
        },
      },
    );
    let settled = false,
      lastProgress = -10;
    let updates = Promise.resolve();
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "El análisis superó 12 minutos. Procesa una región más corta.",
          ),
        ),
      12 * 60000,
    );
    function finish(error?: Error, value?: TranscriptionResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(value!);
    }
    worker.on("message", (message: TranscriptionWorkerMessage) => {
      if (
        message.type === "progress" &&
        message.value.progress - lastProgress >= 5
      ) {
        lastProgress = message.value.progress;
        updates = updates.then(() => options.onProgress?.(message.value));
        void updates.catch((error) => finish(error));
      } else if (message.type === "complete") {
        void updates.then(() => finish(undefined, message.result));
      } else if (message.type === "error") finish(new Error(message.message));
    });
    worker.once("error", (error) =>
      finish(error instanceof Error ? error : new Error(String(error))),
    );
    worker.once("exit", (code) => {
      if (code !== 0 && !settled)
        finish(new Error("El motor interno terminó inesperadamente."));
    });
  });
  return transcriptionDocument(result, title, options);
}
