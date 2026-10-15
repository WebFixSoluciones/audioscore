import "server-only";
import { Worker } from "node:worker_threads";
import { join, dirname, sep } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import ffmpegStatic from "ffmpeg-static";
import { transcriptionDocument } from "./document";
import type { MusicDocument } from "@/lib/music/types";
import type { AudioAssetMetadata } from "../iatpe/types";
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
    timeoutMs?: number;
    signal?: AbortSignal;
    reduceNoise?: boolean;
  } = {},
) {
  options.signal?.throwIfAborted();
  const deadline =
    Date.now() + Math.min(options.timeoutMs ?? 12 * 60000, 12 * 60000);
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
        ...(options.reduceNoise ? ["-af", "afftdn=nr=6:nf=-50:tn=1"] : []),
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
    const timer = setTimeout(
      () => {
        child.kill();
        reject(new Error("Timeout preparando audio para transcripción"));
      },
      Math.min(120000, Math.max(1, deadline - Date.now())),
    );
    const abort = () => {
      child.kill();
      reject(new DOMException("Análisis cancelado", "AbortError"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (code === 0) resolve();
      else
        reject(new Error("No se pudo preparar el audio para transcripción."));
    });
  });
  options.signal?.throwIfAborted();
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
      Math.max(1, deadline - Date.now()),
    );
    const abort = () =>
      finish(new DOMException("Análisis cancelado", "AbortError"));
    options.signal?.addEventListener("abort", abort, { once: true });
    function finish(error?: Error, value?: TranscriptionResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
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

export interface TranscribedNoteEvent {
  startSeconds: number;
  durationSeconds: number;
  midiPitch: number;
  velocity: number;
  confidence: number;
}

export interface StemTranscriptionOptions {
  stem: AudioAssetMetadata;
  globalTempoBpm?: number;
  skipInstrumentReclassification?: boolean;
  skipTempoReestimation?: boolean;
  signal?: AbortSignal;
}

export interface StemTranscriptionResult {
  stemId: string;
  kind: string;
  notes: TranscribedNoteEvent[];
  notesCount: number;
  amtWallMs: number;
  reusedPersistentWorker: boolean;
  skippedRedundantClassification: boolean;
  skippedRedundantTempoEstimation: boolean;
  cacheHit: boolean;
}

class PersistentAmtWorkerPool {
  private isInitialized = false;
  private activeExecutions = 0;
  private readonly cache = new Map<string, StemTranscriptionResult>();
  private readonly inFlight = new Map<string, Promise<StemTranscriptionResult>>();

public async ensureWarm(): Promise<void> {
    if (!this.isInitialized) {
      this.isInitialized = true;
    }
  }

public getStats() {
    return {
      isWarm: this.isInitialized,
      activeExecutions: this.activeExecutions,
      cachedStemsCount: this.cache.size,
      inFlightCount: this.inFlight.size,
    };
  }

public async transcribeStem(
    options: StemTranscriptionOptions,
    inferFn: (stem: AudioAssetMetadata, signal?: AbortSignal) => Promise<TranscribedNoteEvent[]>
  ): Promise<StemTranscriptionResult> {
    if (options.signal?.aborted) {
      throw new Error(`Transcripción AMT cancelada para ${options.stem.id}`);
    }

const skipClass = options.skipInstrumentReclassification ?? true;
    const skipTempo = options.skipTempoReestimation ?? Boolean(options.globalTempoBpm);
    const cacheKey = createHash("sha256")
      .update(
        JSON.stringify({
          sha256: options.stem.sha256,
          kind: options.stem.kind,
          bpm: options.globalTempoBpm ?? null,
          skipClass,
          skipTempo,
        })
      )
      .digest("hex");

const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, cacheHit: true };
    }

const existingPromise = this.inFlight.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

const runPromise = (async (): Promise<StemTranscriptionResult> => {
      const wasAlreadyWarm = this.isInitialized;
      await this.ensureWarm();
      this.activeExecutions += 1;
      const t0 = performance.now();
      try {
        const notes = await inferFn(options.stem, options.signal);
        const amtWallMs = Number((performance.now() - t0).toFixed(2));
        const result: StemTranscriptionResult = {
          stemId: options.stem.id,
          kind: options.stem.kind,
          notes,
          notesCount: notes.length,
          amtWallMs,
          reusedPersistentWorker: wasAlreadyWarm,
          skippedRedundantClassification: skipClass,
          skippedRedundantTempoEstimation: skipTempo,
          cacheHit: false,
        };
        this.cache.set(cacheKey, result);
        return result;
      } finally {
        this.activeExecutions = Math.max(0, this.activeExecutions - 1);
        this.inFlight.delete(cacheKey);
      }
    })();

this.inFlight.set(cacheKey, runPromise);
    return runPromise;
  }
}

export const globalAmtWorkerPool = new PersistentAmtWorkerPool();
