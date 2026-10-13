import type { MusicDocument, AudioSource } from "./types";
import { scoreEvents } from "./score-layout";
export type FretPosition = { str: number; fret: number };
export function assignFrets(
  pitches: number[],
  bass = false,
): FretPosition[] | undefined {
  const tuning = bass ? [43, 38, 33, 28] : [64, 59, 55, 50, 45, 40];
  const sorted = [...new Set(pitches)].sort((a, b) => a - b);
  if (!sorted.length || sorted.length > tuning.length) return;
  let best: FretPosition[] | undefined,
    bestCost = Infinity;
  function search(at: number, positions: FretPosition[], cost: number) {
    if (cost >= bestCost) return;
    if (at === sorted.length) {
      const frets = positions.map((p) => p.fret).filter((f) => f > 0);
      const spread = frets.length ? Math.max(...frets) - Math.min(...frets) : 0;
      if (spread > 5 && positions.length > 1) return;
      const total = cost + spread * 3;
      if (total < bestCost) {
        best = positions.map((p) => ({ ...p }));
        bestCost = total;
      }
      return;
    }
    for (let i = 0; i < tuning.length; i++) {
      const fret = sorted[at] - tuning[i];
      if (fret < 0 || fret > 24 || positions.some((p) => p.str === i + 1))
        continue;
      search(at + 1, [...positions, { str: i + 1, fret }], cost + fret);
    }
  }
  search(0, [], 0);
  return best?.sort((a, b) => a.str - b.str);
}
export function tablatureAttacks(doc: MusicDocument, source: AudioSource) {
  const grouped = new Map<number, { pitches: number[]; eventId: string }>();
  for (const event of scoreEvents(doc, source, true)) {
    if (event.midiNote === undefined || !["note", "chord"].includes(event.type))
      continue;
    const group = grouped.get(event.startTick) ?? {
      pitches: [],
      eventId: event.id,
    };
    group.pitches.push(event.midiNote);
    grouped.set(event.startTick, group);
  }
  return [...grouped].map(([startTick, group]) => ({
    startTick,
    eventId: group.eventId,
    positions: assignFrets(
      group.pitches,
      source.program >= 32 && source.program <= 39,
    ),
  }));
}
