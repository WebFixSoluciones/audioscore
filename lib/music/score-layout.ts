import {
  PPQ,
  type AudioSource,
  type MusicDocument,
  type MusicalEvent,
} from "./types";
import { secondsToTicks } from "./tempo-map";

export function scoreOriginTick(doc: MusicDocument) {
  return doc.provenance === "transcription"
    ? secondsToTicks(doc.analysis?.scoreOriginSeconds ?? 0, doc.tempoMap)
    : 0;
}

export type ScoreEvent = MusicalEvent & { staff: number };

/** Written timing is a separate view; the audio/MIDI document is never mutated. */
export function scoreEvents(
  doc: MusicDocument,
  source: AudioSource,
  readable: boolean,
): ScoreEvent[] {
  const origin = scoreOriginTick(doc),
    step = PPQ / 4;
  const events: ScoreEvent[] = [];
  for (const e of doc.events.filter(
    (n) => n.sourceId === source.id && n.type !== "automation",
  )) {
    const start = Math.max(0, e.startTick - origin),
      end = Math.max(start + 1, e.startTick + e.durationTicks - origin);
    const startTick = readable ? Math.round(start / step) * step : start;
    const until = readable
      ? Math.max(startTick + step, Math.round(end / step) * step)
      : end;
    const pitches =
      e.pitches ?? (e.midiNote === undefined ? [undefined] : [e.midiNote]);
    for (const pitch of pitches)
      events.push({
        ...e,
        pitches: undefined,
        midiNote: pitch,
        startTick,
        durationTicks: until - startTick,
        staff:
          source.notationLayout === "piano" &&
          pitch !== undefined &&
          pitch < (source.notationSplitPitch ?? 60)
            ? 2
            : 1,
      });
  }
  events.sort(
    (a, b) =>
      a.startTick - b.startTick || (a.midiNote ?? 0) - (b.midiNote ?? 0),
  );
  if (
    readable &&
    doc.provenance === "transcription" &&
    source.notationLayout === "piano"
  ) {
    for (const staff of [1, 2]) {
      const onsets = [
        ...new Set(
          events.filter((e) => e.staff === staff).map((e) => e.startTick),
        ),
      ];
      for (const e of events.filter(
        (e) => e.staff === staff && !e.isHumanReviewed && e.type !== "rest",
      )) {
        const next = onsets.find((t) => t > e.startTick);
        // Acoustic decay/pedal is not a notated held voice. The performed view retains it.
        if (next !== undefined)
          e.durationTicks = Math.min(e.durationTicks, next - e.startTick);
      }
      for (const onset of onsets) {
        const chord = events.filter(
          (e) =>
            e.staff === staff &&
            e.startTick === onset &&
            !e.isHumanReviewed &&
            e.type !== "rest",
        );
        const duration = Math.max(0, ...chord.map((e) => e.durationTicks));
        for (const e of chord) e.durationTicks = duration;
      }
    }
  }
  return events;
}

export type ScoreChord = ScoreEvent & { pitches?: number[] };
export function scoreVoices(events: ScoreEvent[], staff: number) {
  const grouped: ScoreChord[] = [];
  for (const e of events.filter((e) => e.staff === staff)) {
    const group = grouped.findLast(
      (g) =>
        g.startTick === e.startTick &&
        g.durationTicks === e.durationTicks &&
        g.type === e.type &&
        g.articulation === e.articulation &&
        g.isHumanReviewed === e.isHumanReviewed,
    );
    if (group && e.midiNote !== undefined && group.midiNote !== undefined) {
      group.pitches = [
        ...new Set([...(group.pitches ?? [group.midiNote]), e.midiNote]),
      ];
      group.confidence = Math.min(group.confidence, e.confidence);
    } else grouped.push({ ...e });
  }
  const voices: ScoreChord[][] = [];
  for (const e of grouped) {
    let voice = voices.find(
      (v) =>
        v[v.length - 1].startTick + v[v.length - 1].durationTicks <=
        e.startTick,
    );
    if (!voice) {
      voice = [];
      voices.push(voice);
    }
    voice.push(e);
  }
  return voices.length ? voices : [[]];
}
