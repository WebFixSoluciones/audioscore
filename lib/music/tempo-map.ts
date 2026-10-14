import { PPQ, type TempoChange, type MusicDocument } from "./types";
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
export function validateTempoMap(map: TempoChange[]) {
  if (
    !map.length ||
    map[0].startSeconds !== 0 ||
    map.some(
      (t, i) =>
        !Number.isFinite(t.bpm) ||
        t.bpm < 20 ||
        t.bpm > 400 ||
        !Number.isFinite(t.startSeconds) ||
        t.startSeconds < 0 ||
        (i > 0 && t.startSeconds <= map[i - 1].startSeconds),
    )
  )
    throw new Error("Mapa de tempo inválido");
}
export function secondsToTicks(seconds: number, map: TempoChange[]): number {
  validateTempoMap(map);
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("Tiempo inválido");
  let ticks = 0;
  for (let i = 0; i < map.length; i++) {
    const end = Math.min(seconds, map[i + 1]?.startSeconds ?? seconds);
    if (end > map[i].startSeconds)
      ticks += ((end - map[i].startSeconds) * map[i].bpm * PPQ) / 60;
    if (end === seconds) break;
  }
  return Math.round(ticks);
}
export function ticksToSeconds(ticks: number, map: TempoChange[]): number {
  validateTempoMap(map);
  if (!Number.isFinite(ticks) || ticks < 0) throw new Error("Ticks inválidos");
  let left = ticks;
  for (let i = 0; i < map.length; i++) {
    const rate = (map[i].bpm * PPQ) / 60;
    const span =
      ((map[i + 1]?.startSeconds ?? Infinity) - map[i].startSeconds) * rate;
    if (left <= span) return map[i].startSeconds + left / rate;
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

export interface BarInfo {
  barNumber: number;
  startSeconds: number;
  endSeconds: number;
  startTick: number;
  durationTicks: number;
  bpm: number;
  beats: Array<{
    beatNumber: number;
    timeSeconds: number;
    isDownbeat: boolean;
  }>;
}

export function computeBarsAndBeats(
  tempoMap: TempoChange[],
  durationSeconds: number,
  timeSignature: [number, number] = [4, 4],
): BarInfo[] {
  validateTempoMap(tempoMap);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const [numerator, denominator] = timeSignature;
  const quarterBeatsPerBar = (numerator * 4) / denominator;
  const ticksPerBar = Math.round(quarterBeatsPerBar * PPQ);
  const ticksPerBeat = Math.round((4 / denominator) * PPQ);
  const totalTicks = secondsToTicks(durationSeconds, tempoMap);

  const bars: BarInfo[] = [];
  let currentBarTick = 0;
  let barIndex = 1;

  while (currentBarTick < totalTicks) {
    const nextBarTick = Math.min(totalTicks, currentBarTick + ticksPerBar);
    const startSec = ticksToSeconds(currentBarTick, tempoMap);
    const endSec = ticksToSeconds(nextBarTick, tempoMap);

    let effectiveBpm = tempoMap[0].bpm;
    for (const t of tempoMap) {
      if (t.startSeconds <= startSec) effectiveBpm = t.bpm;
      else break;
    }

    const beats: Array<{
      beatNumber: number;
      timeSeconds: number;
      isDownbeat: boolean;
    }> = [];
    for (let b = 0; b < numerator; b++) {
      const beatTick = currentBarTick + b * ticksPerBeat;
      if (beatTick >= totalTicks) break;
      beats.push({
        beatNumber: b + 1,
        timeSeconds: ticksToSeconds(beatTick, tempoMap),
        isDownbeat: b === 0,
      });
    }

    bars.push({
      barNumber: barIndex,
      startSeconds: startSec,
      endSeconds: endSec,
      startTick: currentBarTick,
      durationTicks: nextBarTick - currentBarTick,
      bpm: effectiveBpm,
      beats,
    });

    currentBarTick = nextBarTick;
    barIndex++;
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
  for (const b of bar.beats) {
    if (time >= b.timeSeconds) {
      activeBeat = b.beatNumber;
      isDownbeat = b.isDownbeat;
    } else {
      break;
    }
  }

  return {
    barNumber: bar.barNumber,
    beatNumber: activeBeat,
    isDownbeat,
  };
}
