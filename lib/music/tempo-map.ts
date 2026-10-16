import { PPQ, type TempoChange, type MusicDocument } from "./types";

/**
 * Elastic Tempo Map & Measure Grid Engine (Delivery 5 — Fix P2.3).
 * - Aligns bars and beats to `downbeatTimes` and `scoreOriginSeconds` instead of forcing tick 0 at t=0.
 * - Explicitly models pickup bars (anacrusa, `barNumber: 0`, `isPickupBar: true`) when `scoreOriginSeconds > 0`.
 * - Supports variable time signature maps (`timeSignatures`) and variable live tempo curves (`TempoPoint[]`).
 */

export interface TempoPoint {
  timeSeconds: number;
  bpm: number;
}

export interface TimeSignatureChange {
  barNumber: number;
  numerator: number;
  denominator: number;
}

export interface BarGridEntry {
  barNumber: number;
  isPickupBar: boolean;
  startSeconds: number;
  endSeconds: number;
  bpm: number;
  numerator: number;
  denominator: number;
  beatTimesSeconds: number[];
  startTick?: number;
  durationTicks?: number;
  beats: Array<{
    beatNumber: number;
    timeSeconds: number;
    isDownbeat: boolean;
  }>;
}

export type BarInfo = BarGridEntry;

export interface ComputeBarsOptions {
  durationSeconds: number;
  tempoMap: Array<TempoChange | TempoPoint>;
  downbeatTimes?: number[];
  scoreOriginSeconds?: number;
  timeSignatures?: TimeSignatureChange[];
  defaultNumerator?: number;
  defaultDenominator?: number;
}

export function withTempoMap(
  doc: MusicDocument,
  tempoMap: TempoChange[],
): MusicDocument {
  validateTempoMap(tempoMap);
  return {
    ...doc,
    tempoMap,
    events: doc.events.map((e) => {
      const startTick = secondsToTicks(e.startSeconds, tempoMap);
      return {
        ...e,
        startTick,
        durationTicks: Math.max(
          1,
          secondsToTicks(e.startSeconds + e.durationSeconds, tempoMap) -
            startTick,
        ),
      };
    }),
  };
}

export function validateTempoMap(pointsOrChanges: any[]): TempoPoint[] {
  if (!pointsOrChanges || pointsOrChanges.length === 0) {
    throw new Error("Mapa de tempo inválido");
  }
  const firstSec =
    pointsOrChanges[0].startSeconds !== undefined
      ? pointsOrChanges[0].startSeconds
      : pointsOrChanges[0].timeSeconds;
  if (firstSec !== 0) {
    throw new Error("Mapa de tempo inválido");
  }

  for (let i = 0; i < pointsOrChanges.length; i++) {
    const p = pointsOrChanges[i];
    const sec = p.startSeconds !== undefined ? p.startSeconds : p.timeSeconds;
    if (
      !Number.isFinite(p.bpm) ||
      p.bpm < 20 ||
      p.bpm > 400 ||
      !Number.isFinite(sec) ||
      sec < 0
    ) {
      throw new Error("Mapa de tempo inválido");
    }
    if (i > 0) {
      const prevSec =
        pointsOrChanges[i - 1].startSeconds !== undefined
          ? pointsOrChanges[i - 1].startSeconds
          : pointsOrChanges[i - 1].timeSeconds;
      if (sec <= prevSec) {
        throw new Error("Mapa de tempo inválido");
      }
    }
  }

  return pointsOrChanges.map((p) => ({
    timeSeconds: p.timeSeconds !== undefined ? Number(p.timeSeconds) : Number(p.startSeconds ?? 0),
    bpm: Number(p.bpm),
  }));
}

export function getBpmAtTime(tempoMap: Array<TempoPoint | TempoChange>, timeSeconds: number): number {
  if (!tempoMap || tempoMap.length === 0) return 120;
  let activeBpm = tempoMap[0].bpm;
  for (const pt of tempoMap) {
    const sec = (pt as any).startSeconds !== undefined ? (pt as any).startSeconds : (pt as any).timeSeconds;
    if (sec <= timeSeconds + 1e-6) {
      activeBpm = pt.bpm;
    } else {
      break;
    }
  }
  return activeBpm;
}

export function secondsToTicks(seconds: number, map: any[]): number {
  validateTempoMap(map);
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("Tiempo inválido");
  let ticks = 0;
  for (let i = 0; i < map.length; i++) {
    const sSec = map[i].startSeconds ?? map[i].timeSeconds ?? 0;
    const nextSSec = map[i + 1]?.startSeconds ?? map[i + 1]?.timeSeconds ?? seconds;
    const end = Math.min(seconds, nextSSec);
    if (end > sSec)
      ticks += ((end - sSec) * map[i].bpm * PPQ) / 60;
    if (end === seconds) break;
  }
  return Math.round(ticks);
}

export function ticksToSeconds(ticks: number, map: any[]): number {
  if (!Number.isFinite(ticks) || ticks < 0) throw new Error("Ticks inválidos");
  let left = ticks;
  for (let i = 0; i < map.length; i++) {
    const rate = (map[i].bpm * PPQ) / 60;
    const sSec = map[i].startSeconds ?? map[i].timeSeconds ?? 0;
    const nextSSec = map[i + 1]?.startSeconds ?? map[i + 1]?.timeSeconds ?? Infinity;
    const span = (nextSSec - sSec) * rate;
    if (left <= span) return sSec + left / rate;
    left -= span;
  }
  throw new Error("No se pudo convertir el tiempo");
}

export function beatsToMeasure(beats: number, signature: [number, number]) {
  const quarterBeats = (signature[0] * 4) / signature[1];
  return {
    measure: Math.floor(beats / quarterBeats) + 1,
    beat: ((beats % quarterBeats) * signature[1]) / 4 + 1,
  };
}

export function computeBarsAndBeats(
  optionsOrTempoMap: ComputeBarsOptions | TempoChange[] | TempoPoint[],
  durationSeconds?: number,
  timeSignature: [number, number] = [4, 4],
): BarGridEntry[] {
  let opts: ComputeBarsOptions;
  if (Array.isArray(optionsOrTempoMap)) {
    opts = {
      tempoMap: optionsOrTempoMap,
      durationSeconds: durationSeconds ?? 0,
      defaultNumerator: timeSignature[0],
      defaultDenominator: timeSignature[1],
    };
  } else {
    opts = optionsOrTempoMap;
  }

  const durSec = Math.max(0.1, opts.durationSeconds);
  const validTempo = validateTempoMap(opts.tempoMap);
  const defaultNum = opts.defaultNumerator ?? 4;
  const defaultDen = opts.defaultDenominator ?? 4;
  const sigChanges = [...(opts.timeSignatures ?? [{ barNumber: 1, numerator: defaultNum, denominator: defaultDen }])]
    .sort((a, b) => a.barNumber - b.barNumber);

  const getSignatureForBar = (barNum: number) => {
    let active = { numerator: defaultNum, denominator: defaultDen };
    for (const sig of sigChanges) {
      if (sig.barNumber <= barNum) {
        active = { numerator: sig.numerator, denominator: sig.denominator };
      } else {
        break;
      }
    }
    return active;
  };

  const downbeats = (opts.downbeatTimes ?? [])
    .filter((t) => Number.isFinite(t) && t >= 0 && t < durSec)
    .sort((a, b) => a - b);

  const bar1Origin =
    opts.scoreOriginSeconds !== undefined
      ? Math.max(0, opts.scoreOriginSeconds)
      : downbeats.length > 0
      ? downbeats[0]
      : 0;

  const bars: BarGridEntry[] = [];

  // 1. Explicit Pickup Bar (Anacrusa, barNumber = 0) if Bar 1 starts after t = 0.05s
  if (bar1Origin > 0.05) {
    const pickupBpm = getBpmAtTime(validTempo, 0);
    const sig = getSignatureForBar(1);
    const beatDur = (60 / pickupBpm) * (4 / sig.denominator);
    const beatTimes: number[] = [];
    const beats: Array<{ beatNumber: number; timeSeconds: number; isDownbeat: boolean }> = [];
    for (let t = bar1Origin - beatDur; t >= -1e-4; t -= beatDur) {
      beatTimes.unshift(Number(Math.max(0, t).toFixed(4)));
    }
    if (beatTimes.length === 0 || beatTimes[0] > 0.05) {
      beatTimes.unshift(0);
    }
    beatTimes.forEach((bt, idx) => {
      beats.push({
        beatNumber: idx + 1,
        timeSeconds: bt,
        isDownbeat: false,
      });
    });
    const sTick = secondsToTicks(0, validTempo);
    const eTick = secondsToTicks(bar1Origin, validTempo);
    bars.push({
      barNumber: 0,
      isPickupBar: true,
      startSeconds: 0,
      endSeconds: Number(bar1Origin.toFixed(4)),
      startTick: sTick,
      durationTicks: Math.max(1, eTick - sTick),
      bpm: Number(pickupBpm.toFixed(2)),
      numerator: sig.numerator,
      denominator: sig.denominator,
      beatTimesSeconds: beatTimes,
      beats,
    });
  }

  // 2. If verified downbeatTimes are provided, build bars anchored directly to downbeats
  if (downbeats.length >= 2) {
    const anchoredDownbeats = downbeats.filter((d) => d >= bar1Origin - 1e-4);
    for (let i = 0; i < anchoredDownbeats.length; i++) {
      const barNumber = i + 1;
      const startSec = anchoredDownbeats[i];
      const sig = getSignatureForBar(barNumber);
      const nextDownbeat =
        i + 1 < anchoredDownbeats.length
          ? anchoredDownbeats[i + 1]
          : Math.min(
              durSec,
              startSec + sig.numerator * (60 / getBpmAtTime(validTempo, startSec)) * (4 / sig.denominator)
            );
      if (nextDownbeat <= startSec + 1e-4) continue;

      const barDuration = nextDownbeat - startSec;
      const quarterBeatsInBar = sig.numerator * (4 / sig.denominator);
      const effectiveBpm = (quarterBeatsInBar * 60) / barDuration;
      const beatStep = barDuration / sig.numerator;
      const beatTimes: number[] = [];
      const beats: Array<{ beatNumber: number; timeSeconds: number; isDownbeat: boolean }> = [];
      for (let b = 0; b < sig.numerator; b++) {
        const bt = startSec + b * beatStep;
        if (bt < durSec) {
          const tSec = Number(bt.toFixed(4));
          beatTimes.push(tSec);
          beats.push({
            beatNumber: b + 1,
            timeSeconds: tSec,
            isDownbeat: b === 0,
          });
        }
      }

      const sTick = secondsToTicks(startSec, validTempo);
      const eTick = secondsToTicks(nextDownbeat, validTempo);
      bars.push({
        barNumber,
        isPickupBar: false,
        startSeconds: Number(startSec.toFixed(4)),
        endSeconds: Number(nextDownbeat.toFixed(4)),
        startTick: sTick,
        durationTicks: Math.max(1, eTick - sTick),
        bpm: Number(Math.min(400, Math.max(20, effectiveBpm)).toFixed(2)),
        numerator: sig.numerator,
        denominator: sig.denominator,
        beatTimesSeconds: beatTimes,
        beats,
      });
    }
    return bars;
  }

  // 3. Otherwise integrate forward from bar1Origin using the TempoMap and TimeSignatures
  let cursor = bar1Origin;
  let barNumber = 1;
  while (cursor < durSec - 1e-4 && barNumber <= 2000) {
    const sig = getSignatureForBar(barNumber);
    const bpm = getBpmAtTime(validTempo, cursor);
    const beatDur = (60 / bpm) * (4 / sig.denominator);
    const barDur = beatDur * sig.numerator;
    const endSec = Math.min(durSec, cursor + barDur);
    const beatTimes: number[] = [];
    const beats: Array<{ beatNumber: number; timeSeconds: number; isDownbeat: boolean }> = [];
    for (let b = 0; b < sig.numerator; b++) {
      const bt = cursor + b * beatDur;
      if (bt < endSec + 1e-4 && bt <= durSec) {
        const tSec = Number(bt.toFixed(4));
        beatTimes.push(tSec);
        beats.push({
          beatNumber: b + 1,
          timeSeconds: tSec,
          isDownbeat: b === 0,
        });
      }
    }

    const sTick = secondsToTicks(cursor, validTempo);
    const eTick = secondsToTicks(endSec, validTempo);
    bars.push({
      barNumber,
      isPickupBar: false,
      startSeconds: Number(cursor.toFixed(4)),
      endSeconds: Number(endSec.toFixed(4)),
      startTick: sTick,
      durationTicks: Math.max(1, eTick - sTick),
      bpm: Number(bpm.toFixed(2)),
      numerator: sig.numerator,
      denominator: sig.denominator,
      beatTimesSeconds: beatTimes,
      beats,
    });

    cursor = endSec;
    barNumber += 1;
  }

  return bars;
}

export function getCurrentBarAndBeat(
  currentTime: number,
  bars: BarInfo[],
): { barNumber: number; beatNumber: number; isDownbeat: boolean } {
  if (!bars.length) return { barNumber: 1, beatNumber: 1, isDownbeat: true };
  const time = Math.max(0, currentTime);
  const bar =
    bars.find((b) => time >= b.startSeconds && time < b.endSeconds) ??
    (time >= bars[bars.length - 1].endSeconds
      ? bars[bars.length - 1]
      : bars[0]);

  let activeBeat = 1;
  let isDownbeat = true;
  if (bar.beats && bar.beats.length > 0) {
    for (const b of bar.beats) {
      if (time >= b.timeSeconds) {
        activeBeat = b.beatNumber;
        isDownbeat = b.isDownbeat;
      } else {
        break;
      }
    }
  } else if (bar.beatTimesSeconds && bar.beatTimesSeconds.length > 0) {
    for (let i = 0; i < bar.beatTimesSeconds.length; i++) {
      if (time >= bar.beatTimesSeconds[i]) {
        activeBeat = i + 1;
        isDownbeat = i === 0 && !bar.isPickupBar;
      } else {
        break;
      }
    }
  }

  return {
    barNumber: bar.barNumber,
    beatNumber: activeBeat,
    isDownbeat,
  };
}
