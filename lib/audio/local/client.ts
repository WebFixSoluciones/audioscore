"use client";
import type { LocalJob, LocalResult } from "./types";
import type { TranscriptionProgress } from "../transcription/types";
import { defaultAnalysisOptions, type LocalAnalysisOptions } from "./options";
class LocalRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function localRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/local/${path}`, {
    ...options,
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok)
    throw new LocalRequestError(
      result.error || "El motor local no respondió.",
      response.status,
    );
  return result as T;
}
export async function analyzeOnMachine(
  file: File,
  report: (value: TranscriptionProgress) => void,
  signal: AbortSignal,
  onJob: (id: string) => void,
  options: LocalAnalysisOptions = defaultAnalysisOptions,
) {
  report({ stage: "Copiando audio al motor de este equipo", progress: 1 });
  const { job } = await localRequest<{ job: LocalJob }>("jobs", {
    method: "POST",
    body: file,
    signal,
    headers: {
      "content-type": file.type || "audio/wav",
      "x-audio-name": encodeURIComponent(file.name),
      "x-analysis-options": JSON.stringify(options),
    },
  });
  onJob(job.id);
  return waitForMachineJob(job.id, report, signal);
}
function delay(signal: AbortSignal, ms: number) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      reject(new DOMException("Análisis cancelado", "AbortError"));
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}
export async function waitForMachineJob(
  id: string,
  report: (value: TranscriptionProgress) => void,
  signal: AbortSignal,
) {
  const cancel = () => {
    void localRequest(`jobs/${id}`, { method: "DELETE" }).catch(() => {});
  };
  if (signal.aborted) {
    cancel();
    signal.throwIfAborted();
  }
  signal.addEventListener("abort", cancel, { once: true });
  let progress = 0;
  async function read<T>(path: string) {
    for (let retry = 0; ; retry++) {
      try {
        return await localRequest<T>(path, { signal });
      } catch (e) {
        signal.throwIfAborted();
        if (e instanceof LocalRequestError && e.status < 500) throw e;
        if (retry >= 12)
          throw new Error(
            "No se pudo recuperar el progreso. El resultado temporal permanece en este equipo; aún no se guardó como proyecto.",
          );
        report({ stage: "Recuperando el progreso del motor local…", progress });
        await delay(signal, Math.min(10000, 1500 * (retry + 1)));
      }
    }
  }
  try {
    while (true) {
      signal.throwIfAborted();
      const status = await read<{ job: LocalJob }>(`jobs/${id}`);
      progress = status.job.progress;
      report({ stage: status.job.stage, progress: status.job.progress });
      if (status.job.status === "completed")
        return await read<LocalResult>(`jobs/${id}/result`);
      if (status.job.status === "failed")
        throw new Error(status.job.error || "No se pudo analizar el audio.");
      if (status.job.status === "cancelled")
        throw new DOMException("Análisis cancelado", "AbortError");
      await delay(signal, 1500);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
