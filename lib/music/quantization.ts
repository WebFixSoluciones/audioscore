import { PPQ, type MusicDocument, type MusicalEvent } from "./types";
import { ticksToSeconds } from "./tempo-map";
export function quantizeEvents(
  events: MusicalEvent[],
  doc: MusicDocument,
  division = 4,
  region?: [number, number],
): MusicalEvent[] {
  if (![1, 2, 3, 4, 6, 8].includes(division))
    throw new Error("Cuantización inválida");
  const step = PPQ / division;
  return events.map((e) => {
    if (region && (e.startSeconds < region[0] || e.startSeconds >= region[1]))
      return e;
    const startTick = Math.round(Math.round(e.startTick / step) * step);
    const durationTicks = Math.max(
      1,
      Math.round(Math.max(1, Math.round(e.durationTicks / step)) * step),
    );
    const startSeconds = ticksToSeconds(startTick, doc.tempoMap);
    return {
      ...e,
      startTick,
      durationTicks,
      startSeconds,
      durationSeconds:
        ticksToSeconds(startTick + durationTicks, doc.tempoMap) - startSeconds,
    };
  });
}
