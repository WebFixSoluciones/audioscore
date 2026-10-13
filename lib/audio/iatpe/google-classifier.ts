import { instrumentPredictions } from "../transcription/instruments";
import type { GoogleClassificationResult } from "./types";

export interface GoogleClassifierOptions {
  samples?: Float32Array;
  sampleRate?: number;
  precomputedScores?: number[][];
  enableGemini?: boolean;
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

export async function classifyAudioWithGoogleAI(
  options: GoogleClassifierOptions,
): Promise<GoogleClassificationResult> {
  let scores: number[][] = options.precomputedScores ?? [];

  // Si no se pasaron scores precomputados pero sí samples, ejecutar barrido YAMNet si está disponible
  if (!scores.length && options.samples && options.samples.length > 0) {
    try {
      const tf = await import("@tensorflow/tfjs");
      const model = await getYamnetModel();

      // Resample / chunk en 16kHz
      const targetRate = 16000;
      const chunks = Math.min(5, Math.ceil(options.samples.length / (options.sampleRate ?? 22050)));

      for (let c = 0; c < chunks; c++) {
        const input = new Float32Array(48000); // 3 seconds at 16kHz
        const sourceStart = Math.floor((c * 3 * (options.sampleRate ?? 22050)));
        for (let j = 0; j < input.length; j++) {
          const at = sourceStart + Math.floor((j * (options.sampleRate ?? 22050)) / targetRate);
          input[j] = options.samples[at] ?? 0;
        }

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
      // Si la carga directa del grafo falla en entorno de test/CLI, mantener scores vacíos
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
  };
}
