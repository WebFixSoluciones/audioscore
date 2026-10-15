import { probeAudioFormat, streamAudioToFloat32 } from "./stream-decoder";
import { analyzeSpectralProfile } from "./spectral-engine";
import { classifyAudioWithGoogleAI } from "./google-classifier";
import { dispatchChannels } from "./channel-dispatcher";
import {
  iatpeAnalysisResultSchema,
  type IatpeAnalysisResult,
  type ActivityRegion,
  type DistributedPreanalysisResult,
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
  // Para audios mayores a 45s, realiza muestreo distribuido (intro + cuerpo central)
  // para verificar la instrumentación completa y evitar falsos positivos de solista en intros
  let decoded: { samples: Float32Array; sampleRate: number; channels: number; durationSeconds: number };
  if (format.durationSeconds > 45 && !options.maxDurationSeconds) {
    const midStart = Math.min(
      format.durationSeconds - 15,
      Math.max(15, format.durationSeconds * 0.45),
    );
    const [intro, body] = await Promise.all([
      streamAudioToFloat32(filePath, {
        targetSampleRate: 16000,
        channels: 1,
        startTimeSeconds: 0,
        maxDurationSeconds: 15,
        signal: options.signal,
      }),
      streamAudioToFloat32(filePath, {
        targetSampleRate: 16000,
        channels: 1,
        startTimeSeconds: midStart,
        maxDurationSeconds: 15,
        signal: options.signal,
      }),
    ]);
    const merged = new Float32Array(intro.samples.length + body.samples.length);
    merged.set(intro.samples, 0);
    merged.set(body.samples, intro.samples.length);
    decoded = {
      samples: merged,
      sampleRate: intro.sampleRate,
      channels: 1,
      durationSeconds: intro.durationSeconds + body.durationSeconds,
    };
  } else {
    decoded = await streamAudioToFloat32(filePath, {
      targetSampleRate: 16000,
      channels: 1,
      maxDurationSeconds: options.maxDurationSeconds ?? Math.min(30, format.durationSeconds),
      signal: options.signal,
    });
  }

  // 3. Perfil espectral de micro-sonidos y frecuencias
  const spectral = analyzeSpectralProfile(decoded.samples, decoded.sampleRate);
  const t2 = performance.now();

  options.signal?.throwIfAborted();

  // 4. Clasificación con IA de Google (YAMNet AudioSet + Gemini opcional)
  const googleClassification = await classifyAudioWithGoogleAI({
    samples: decoded.samples,
    sampleRate: decoded.sampleRate,
    enableGemini: options.enableGemini,
    signal: options.signal,
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

export interface DistributedWindowSample {
  label: "intro" | "early_body" | "mid_core" | "climax" | "outro";
  startSeconds: number;
  endSeconds: number;
  samples: Float32Array;
}

export interface WindowClassificationInput {
  label: DistributedWindowSample["label"];
  startSeconds: number;
  endSeconds: number;
  rmsDb: number;
  spectralCentroidHz: number;
  harmonicRatio: number;
  transientDensity: number;
  scores: Record<string, number>;
}

const WINDOW_ANCHORS: Array<{
  label: DistributedWindowSample["label"];
  ratio: number;
}> = [
  { label: "intro", ratio: 0.08 },
  { label: "early_body", ratio: 0.28 },
  { label: "mid_core", ratio: 0.52 },
  { label: "climax", ratio: 0.74 },
  { label: "outro", ratio: 0.90 },
];

export function buildDistributedWindowRanges(
  totalDurationSeconds: number,
  windowDurationSeconds: number = 6.0
): Array<{ label: DistributedWindowSample["label"]; startSeconds: number; endSeconds: number }> {
  if (totalDurationSeconds <= windowDurationSeconds * 1.5) {
    return [
      {
        label: "intro",
        startSeconds: 0,
        endSeconds: Number(totalDurationSeconds.toFixed(3)),
      },
    ];
  }

return WINDOW_ANCHORS.map(({ label, ratio }) => {
    const center = totalDurationSeconds * ratio;
    const half = windowDurationSeconds / 2;
    const startSeconds = Math.max(0, Math.min(totalDurationSeconds - windowDurationSeconds, center - half));
    const endSeconds = Math.min(totalDurationSeconds, startSeconds + windowDurationSeconds);
    return {
      label,
      startSeconds: Number(startSeconds.toFixed(3)),
      endSeconds: Number(endSeconds.toFixed(3)),
    };
  });
}

export function evaluateDistributedPreanalysis(
  totalDurationSeconds: number,
  windows: WindowClassificationInput[],
  confirmedThreshold: number = 0.65,
  uncertaintyFloor: number = 0.20
): DistributedPreanalysisResult {
  const activityRegions: ActivityRegion[] = [];
  const confirmedSet = new Set<string>();
  const uncertainSet = new Set<string>();
  const activeInstrumentsPerWindow: number[] = [];
  const activeRmsDbValues: number[] = [];

for (const win of windows) {
    if (win.rmsDb > -55) {
      activeRmsDbValues.push(win.rmsDb);
    }
    let windowInstrumentCount = 0;

for (const [instrument, score] of Object.entries(win.scores)) {
      if (score >= confirmedThreshold) {
        confirmedSet.add(instrument);
        windowInstrumentCount += 1;
        activityRegions.push({
          sourceId: `iatpe-${instrument}-${win.label}`,
          instrument,
          startSeconds: win.startSeconds,
          endSeconds: win.endSeconds,
          windowLabel: win.label,
          method: "yamnet_temporal",
          confidence: Number(score.toFixed(4)),
          uncertainPresence: false,
          evidence: {
            rmsDb: win.rmsDb,
            spectralCentroidHz: win.spectralCentroidHz,
            harmonicRatio: win.harmonicRatio,
            transientDensity: win.transientDensity,
          },
        });
      } else if (score >= uncertaintyFloor) {
        // Uncertainty is NEVER discarded as absence; it counts conservatively against solo bypass
        uncertainSet.add(instrument);
        windowInstrumentCount += 1;
        activityRegions.push({
          sourceId: `iatpe-${instrument}-${win.label}-uncertain`,
          instrument,
          startSeconds: win.startSeconds,
          endSeconds: win.endSeconds,
          windowLabel: win.label,
          method: "yamnet_temporal",
          confidence: Number(score.toFixed(4)),
          uncertainPresence: true,
          evidence: {
            rmsDb: win.rmsDb,
            spectralCentroidHz: win.spectralCentroidHz,
            harmonicRatio: win.harmonicRatio,
            transientDensity: win.transientDensity,
          },
        });
      }
    }

activeInstrumentsPerWindow.push(windowInstrumentCount);
  }

for (const c of confirmedSet) {
    uncertainSet.delete(c);
  }

const minRmsDb = activeRmsDbValues.length > 0 ? Math.min(...activeRmsDbValues) : -60;
  const maxRmsDb = activeRmsDbValues.length > 0 ? Math.max(...activeRmsDbValues) : -60;
  const dynamicSpreadDb = maxRmsDb - minRmsDb;
  const maxPolyphonicSourcesInAnyWindow = Math.max(0, ...activeInstrumentsPerWindow);

// Conservative Solo Bypass Rule (Delivery 3):
  // 1. Must have sampled representative coverage across the track (>= 3 windows if duration > 15s)
  // 2. Exactly 1 confirmed instrument globally AND 0 uncertain secondary instruments
  // 3. No window exceeds 1 active source
  // 4. Dynamic spread across windows <= 9.5 dB (prevents solo intro + full band later bypass)
  const hasRepresentativeCoverage = totalDurationSeconds <= 15 || windows.length >= 3;
  const isConfirmedSoloInstrument =
    hasRepresentativeCoverage &&
    confirmedSet.size === 1 &&
    uncertainSet.size === 0 &&
    maxPolyphonicSourcesInAnyWindow <= 1 &&
    dynamicSpreadDb <= 9.5;

let soloBypassReason = "Bypass solista confirmado en todas las ventanas distribuidas.";
  if (!hasRepresentativeCoverage) {
    soloBypassReason = "Cobertura insuficiente de ventanas temporales; se exige separación por seguridad.";
  } else if (confirmedSet.size > 1) {
    soloBypassReason = `Múltiples instrumentos confirmados (${Array.from(confirmedSet).join(", ")}); requiere separación.`;
  } else if (uncertainSet.size > 0) {
    soloBypassReason = `Incertidumbre detectada en fuentes secundarias (${Array.from(uncertainSet).join(", ")}); decisión conservadora activa separación.`;
  } else if (dynamicSpreadDb > 9.5) {
    soloBypassReason = `Salto energético de ${dynamicSpreadDb.toFixed(1)} dB entre secciones (posible entrada tardía de banda); bypass solista denegado.`;
  } else if (confirmedSet.size === 0) {
    soloBypassReason = "Sin instrumento solista confirmado con certeza >= 0.65; se ejecuta separación.";
  }

const totalCandidateChannels = Math.min(64, Math.max(1, confirmedSet.size + uncertainSet.size));

return {
    totalDurationSeconds,
    sampledWindowsCount: windows.length,
    isConfirmedSoloInstrument,
    soloBypassReason,
    detectedInstruments: Array.from(confirmedSet),
    uncertainInstruments: Array.from(uncertainSet),
    activityRegions,
    channelCount: isConfirmedSoloInstrument ? 1 : totalCandidateChannels,
  };
}
