import { probeAudioFormat, streamAudioToFloat32 } from "./stream-decoder";
import { analyzeSpectralProfile } from "./spectral-engine";
import { classifyAudioWithGoogleAI } from "./google-classifier";
import { dispatchChannels } from "./channel-dispatcher";
import {
  iatpeAnalysisResultSchema,
  type IatpeAnalysisResult,
} from "./types";

export interface IatpeRunOptions {
  maxDurationSeconds?: number;
  enableGemini?: boolean;
  signal?: AbortSignal;
}

/**
 * Motor de Procesador Integrado de Tecnologías de Audio (IATPE)
 * Integrated Audio Technology Processor Engine
 * 
 * Orquestador principal de análisis previo de audio:
 * - Decodificación en memoria sin renderizado a WAV.
 * - Extracción de micro-sonidos, STFT y espectro tonal.
 * - Clasificación acústica con IA de Google (YAMNet AudioSet y opcional Gemini).
 * - Despacho dinámico de canales (1 canal directo en solistas o N canales en mezclas).
 */
export async function runIatpeAnalysis(
  filePath: string,
  options: IatpeRunOptions = {},
): Promise<IatpeAnalysisResult> {
  const t0 = performance.now();

  options.signal?.throwIfAborted();

  // 1. Inspección de códec y formato nativo (sin transcodificar)
  const format = await probeAudioFormat(filePath);
  const t1 = performance.now();

  options.signal?.throwIfAborted();

  // 2. Decodificación en streaming hacia memoria (Zero intermediate WAV)
  const decoded = await streamAudioToFloat32(filePath, {
    targetSampleRate: 22050,
    channels: 1,
    maxDurationSeconds: options.maxDurationSeconds ?? Math.min(30, format.durationSeconds),
    signal: options.signal,
  });

  // 3. Perfil espectral de micro-sonidos y frecuencias
  const spectral = analyzeSpectralProfile(decoded.samples, decoded.sampleRate);
  const t2 = performance.now();

  options.signal?.throwIfAborted();

  // 4. Clasificación con IA de Google (YAMNet AudioSet + Gemini opcional)
  const googleClassification = await classifyAudioWithGoogleAI({
    samples: decoded.samples,
    sampleRate: decoded.sampleRate,
    enableGemini: options.enableGemini,
  });
  const t3 = performance.now();

  options.signal?.throwIfAborted();

  // 5. Despacho dinámico de canales (Solo vs Ensamble)
  const channelPlan = dispatchChannels(googleClassification, spectral);
  const t4 = performance.now();

  const result: IatpeAnalysisResult = {
    format,
    spectral,
    googleClassification,
    channelPlan,
    timingsMs: {
      formatProbeMs: Math.round(t1 - t0),
      spectralAnalysisMs: Math.round(t2 - t1),
      classificationMs: Math.round(t3 - t2),
      dispatchMs: Math.round(t4 - t3),
      totalMs: Math.round(t4 - t0),
    },
  };

  return iatpeAnalysisResultSchema.parse(result);
}
