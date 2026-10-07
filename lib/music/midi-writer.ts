import MidiWriter from "midi-writer-js";
import { Midi } from "@tonejs/midi";
import { PPQ, type MusicDocument } from "./types";
import { secondsToTicks } from "./tempo-map";
import { validateDocument } from "./notation-validation";
export function writeMidi(input: MusicDocument, sourceId?: string): Uint8Array {
  const doc = validateDocument(input);
  const sources = doc.sources.filter((s) => !sourceId || s.id === sourceId);
  if (!sources.length) throw new Error("No hay pistas para exportar");
  const conductor = new MidiWriter.Track();
  conductor.addTrackName(doc.title);
  conductor.setTimeSignature(...doc.timeSignature);
  let previousTempoTick = 0;
  for (const t of doc.tempoMap) {
    const tick = secondsToTicks(t.startSeconds, doc.tempoMap);
    conductor.addEvent(
      new MidiWriter.TempoEvent({
        bpm: t.bpm,
        tick,
        delta: tick - previousTempoTick,
      }),
    );
    previousTempoTick = tick;
  }
  if (
    doc.events.some((e) => e.type === "automation" || e.pitchBend !== undefined)
  )
    throw new Error(
      "Esta exportación MIDI no admite automatización ni pitch bend. Usa un adaptador que conserve esos datos.",
    );
  const tracks = sources.map((s) => {
    const track = new MidiWriter.Track();
    track.addTrackName(s.nameEs || s.name);
    track.addEvent(
      new MidiWriter.ProgramChangeEvent({
        instrument: s.program,
        channel: s.channel,
      }),
    );
    const events = doc.events
      .filter(
        (e) =>
          e.sourceId === s.id && ["note", "drum", "chord"].includes(e.type),
      )
      .sort((a, b) => a.startTick - b.startTick);
    for (const e of events) {
      track.addEvent(
        new MidiWriter.NoteEvent({
          pitch: e.pitches ?? [e.midiNote!],
          duration: `T${e.durationTicks}`,
          startTick: e.startTick,
          velocity: Math.round((e.velocity / 127) * 100),
          channel: s.category === "percussive" ? 10 : s.channel,
        }),
      );
    }
    return track;
  });
  const bytes = new MidiWriter.Writer([conductor, ...tracks]).buildFile();
  const parsed = new Midi(bytes);
  const expected = doc.events
    .filter(
      (e) =>
        sources.some((s) => s.id === e.sourceId) &&
        ["note", "drum", "chord"].includes(e.type),
    )
    .reduce((n, e) => n + (e.pitches?.length ?? 1), 0);
  if (
    parsed.header.ppq !== PPQ ||
    parsed.tracks.reduce((n, t) => n + t.notes.length, 0) !== expected
  )
    throw new Error("MIDI no pasó la verificación de eventos");
  return bytes;
}
