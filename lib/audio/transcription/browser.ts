"use client";
import {
  TRANSCRIPTION_SAMPLE_RATE as RATE,
  type TranscriptionProgress,
  type TranscriptionResult,
  type TranscriptionWorkerMessage,
} from "./types";

export async function transcribeInBrowser(
  file: File,
  report: (value: TranscriptionProgress) => void,
  signal: AbortSignal,
  region?: [number, number],
): Promise<TranscriptionResult> {
  if (file.size > 50 * 1024 * 1024)
    throw new Error("La transcripción local admite archivos de hasta 50 MB.");
  if (signal.aborted)
    throw new DOMException("Transcripción cancelada", "AbortError");
  report({ stage: "Preparando el audio", progress: 1 });
  const context = new AudioContext({ sampleRate: RATE });
  let samples: Float32Array;
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > 900)
      throw new Error(
        "La transcripción local admite hasta 15 minutos. Selecciona un archivo más corto.",
      );
    const start = Math.floor((region?.[0] ?? 0) * RATE);
    const end = Math.min(
      decoded.length,
      Math.ceil((region?.[1] ?? decoded.duration) * RATE),
    );
    if (end <= start) throw new Error("La región seleccionada está vacía.");
    samples = new Float32Array(end - start);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const values = decoded.getChannelData(channel);
      for (let i = 0; i < samples.length; i++)
        samples[i] += values[start + i] / decoded.numberOfChannels;
    }
  } finally {
    await context.close();
  }
  if (signal.aborted)
    throw new DOMException("Transcripción cancelada", "AbortError");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./browser.worker.ts", import.meta.url));
    let settled = false;
    const finish = (error?: Error, result?: TranscriptionResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () =>
      finish(new DOMException("Transcripción cancelada", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    worker.onmessage = ({ data }: MessageEvent<TranscriptionWorkerMessage>) => {
      if (data.type === "progress") report(data.value);
      else if (data.type === "complete") finish(undefined, data.result);
      else finish(new Error(data.message));
    };
    worker.onerror = () =>
      finish(
        new Error(
          "El motor de análisis no pudo iniciarse. Recarga el estudio y vuelve a intentarlo.",
        ),
      );
    worker.postMessage({ samples }, [samples.buffer]);
  });
}
