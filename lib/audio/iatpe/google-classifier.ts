import { instrumentPredictions } from "../transcription/instruments";
import type { GoogleClassificationResult } from "./types";

export interface GoogleClassifierOptions {
  samples?: Float32Array;
  sampleRate?: number;
  precomputedScores?: number[][];
  enableGemini?: boolean;
  signal?: AbortSignal;
}

// Cache model in memory across runs to avoid repeated disk reads and recompilations
let cachedYamnetModel: any = null;

async function getYamnetModel() {
  if (cachedYamnetModel) return cachedYamnetModel;
  const tf = await import("@tensorflow/tfjs");

  if (typeof window === "undefined") {
    // Node.js environment: load weights directly from disk without fetch
    const { readFile } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const jsonPath = join(process.cwd(), "public/models/yamnet/model.json");

    const ioHandler = {
      async load() {
        const json = JSON.parse(await readFile(jsonPath, "utf8"));
        const dir = dirname(jsonPath);
        const specs: any[] = [];
        const buffers: ArrayBuffer[] = [];
        for (const g of json.weightsManifest) {
          specs.push(...g.weights);
          for (const p of g.paths) {
            const buf = await readFile(join(dir, p));
            buffers.push(new Uint8Array(buf).buffer);
          }
        }
        const total = buffers.reduce((a, b) => a + b.byteLength, 0);
        const combined = new Uint8Array(total);
        let off = 0;
        for (const b of buffers) {
          combined.set(new Uint8Array(b), off);
          off += b.byteLength;
        }
        return {
          modelTopology: json.modelTopology,
          format: json.format,
          generatedBy: json.generatedBy,
          convertedBy: json.convertedBy,
          weightSpecs: specs,
          weightData: combined.buffer,
        };
      },
    };
    cachedYamnetModel = await tf.loadGraphModel(ioHandler);
  } else {
    cachedYamnetModel = await tf.loadGraphModel("/models/yamnet/model.json");
  }
  return cachedYamnetModel;
}

/**
 * Extracts a 3-second (48,000 samples) window resampled to 16 kHz.
 * When downsampling from higher rates, applies an anti-aliasing low-pass box filter
 * to eliminate spectral folding above the 8 kHz Nyquist limit.
 */
function extract16kWindow(
  samples: Float32Array,
  sourceStartSample: number,
  srcRate: number,
  targetLength = 48000,
): Float32Array {
  const target = new Float32Array(targetLength);
  const targetRate = 16000;

  if (srcRate === targetRate) {
    const end = Math.min(samples.length, sourceStartSample + targetLength);
    const sliceLen = Math.max(0, end - sourceStartSample);
    if (sliceLen > 0) {
      target.set(samples.subarray(sourceStartSample, sourceStartSample + sliceLen));
    }
    return target;
  }

  const step = srcRate / targetRate;
  for (let j = 0; j < targetLength; j++) {
    const center = sourceStartSample + j * step;
    if (center >= samples.length) break;

    if (step > 1) {
      // Downsampling: average over [center, center + step] to eliminate aliasing
      const start = Math.floor(center);
      const end = Math.min(samples.length, Math.ceil(center + step));
      let sum = 0;
      let count = 0;
      for (let k = start; k < end; k++) {
        sum += samples[k];
        count++;
      }
      target[j] = count > 0 ? sum / count : samples[start];
    } else {
      // Linear interpolation
      const idx = Math.floor(center);
      const frac = center - idx;
      const s0 = samples[idx] ?? 0;
      const s1 = samples[idx + 1] ?? s0;
      target[j] = s0 + frac * (s1 - s0);
    }
  }

  return target;
}

export async function classifyAudioWithGoogleAI(
  options: GoogleClassifierOptions,
): Promise<GoogleClassificationResult> {
  let scores: number[][] = options.precomputedScores ?? [];
  let classifierStatus: "confident" | "low_confidence" | "no_candidates" | "failed" = "no_candidates";

  // Si no se pasaron scores precomputados pero sí samples, ejecutar barrido YAMNet si está disponible
  if (!scores.length && options.samples && options.samples.length > 0) {
    try {
      const tf = await import("@tensorflow/tfjs");
      const model = await getYamnetModel();

      const srcRate = options.sampleRate ?? 22050;
      const totalSeconds = options.samples.length / srcRate;
      const maxChunks = 5;
      const numChunks = Math.min(maxChunks, Math.max(1, Math.floor(totalSeconds / 3)));

      for (let c = 0; c < numChunks; c++) {
        options.signal?.throwIfAborted();
        // Ceder el hilo de eventos de Node.js para no bloquear rutas de estado ni cancelación
        await new Promise((r) => setTimeout(r, 0));

        // Muestreo distribuido a lo largo de toda la pista (inicio, medio y final)
        const startSec = numChunks > 1
          ? (c / (numChunks - 1)) * Math.max(0, totalSeconds - 3)
          : 0;
        const sourceStart = Math.floor(startSec * srcRate);
        const input = extract16kWindow(options.samples, sourceStart, srcRate, 48000);

        tf.engine().startScope();
        try {
          const pred = await model.executeAsync(tf.tensor1d(input));
          const outputs = Array.isArray(pred) ? pred : [pred];
          const output = outputs.find((t) => t.shape.at(-1) === 521);
          if (output) {
            const arr = (await output.array()) as number[][];
            scores.push(...arr);
          }
        } finally {
          tf.engine().endScope();
        }
      }
    } catch {
      classifierStatus = "failed";
    }
  }

  // Mapear activaciones de AudioSet con el catálogo musical oficial
  const rawPredictions = instrumentPredictions(scores);

  const candidates = rawPredictions.map((pred) => ({
    label: pred.label,
    category: pred.label.toLowerCase().replace(/\s+/g, "_"),
    activation: Math.round(pred.score * 100) / 100,
    audioSetId: pred.audiosetId,
  }));

  if (classifierStatus !== "failed") {
    classifierStatus = candidates.length > 0 ? (candidates[0].activation >= 0.5 ? "confident" : "low_confidence") : "no_candidates";
  }

  const topCandidate = candidates[0]?.label ?? "General Mixture";
  const topScore = candidates[0]?.activation ?? 0;

  let googleGeminiReview: string | undefined;
  if (options.enableGemini && process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await client.models.generateContent({
        model: process.env.GEMINI_MODEL,
        contents: `Analiza esta lista de instrumentos candidatos detectados por YAMNet AudioSet: ${JSON.stringify(
          candidates,
        )}. Resume en una sola oración concisa la instrumentación predominante y su textura.`,
      });
      googleGeminiReview = response.text?.trim();
    } catch {
      googleGeminiReview = undefined;
    }
  }

  return {
    topCandidate,
    topScore,
    candidates,
    googleGeminiReview,
    classifierStatus,
  };
}
