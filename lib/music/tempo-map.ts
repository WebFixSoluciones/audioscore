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
