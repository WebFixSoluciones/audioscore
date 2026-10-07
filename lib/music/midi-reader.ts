import { Midi } from "@tonejs/midi";
import { PPQ, emptyDocument, type MusicDocument } from "./types";
import { ticksToSeconds } from "./tempo-map";
import { validateDocument } from "./notation-validation";
export function readMidi(bytes: ArrayBuffer | Uint8Array): MusicDocument {
  const midi = new Midi(bytes);
  const doc = emptyDocument();
  doc.title = midi.name || "MIDI importado";
  doc.provenance = "midi_import";
  doc.confidence = 1;
  doc.timeSignature = (midi.header.timeSignatures[0]?.timeSignature ?? [
    4, 4,
  ]) as MusicDocument["timeSignature"];
  doc.tempoMap = midi.header.tempos.map((t) => ({
    startSeconds: midi.header.ticksToSeconds(t.ticks),
    bpm: t.bpm,
    confidence: 1,
  }));
  if (!doc.tempoMap.length || doc.tempoMap[0].startSeconds > 0)
    doc.tempoMap.unshift({ startSeconds: 0, bpm: 120, confidence: 1 });
  midi.tracks
    .filter((t) => t.notes.length)
    .forEach((track, i) => {
      const id = `track-${i}`;
      doc.sources.push({
        id,
        name: track.name || track.instrument.name,
        nameEs: track.name || track.instrument.name,
        category: track.instrument.percussion ? "percussive" : "tonal",
        family: track.instrument.family,
        acousticOrElectronic: "unknown",
        analogOrDigital: "unknown",
        polyphony: "unknown",
        confidence: 1,
        evidence: "detected",
        program: track.instrument.number,
        notationLayout:
          !track.instrument.percussion && track.instrument.number <= 7
            ? "piano"
            : "single",
        channel: track.channel + 1,
        warnings: [
          "El instrumento proviene del programa MIDI; no identifica el timbre del audio.",
        ],
      });
      track.notes.forEach((n, j) => {
        const startTick = Math.round((n.ticks * PPQ) / midi.header.ppq);
        const durationTicks = Math.max(
          1,
          Math.round((n.durationTicks * PPQ) / midi.header.ppq),
        );
        const startSeconds = ticksToSeconds(startTick, doc.tempoMap);
        doc.events.push({
          id: `${id}-${j}`,
          sourceId: id,
          type: track.instrument.percussion ? "drum" : "note",
          startSeconds,
          durationSeconds:
            ticksToSeconds(startTick + durationTicks, doc.tempoMap) -
            startSeconds,
          startTick,
          durationTicks,
          midiNote: n.midi,
          velocity: Math.max(1, Math.round(n.velocity * 127)),
          articulation: "normal",
          confidence: 1,
          isHumanReviewed: false,
        });
      });
    });
  doc.durationSeconds = Math.max(
    midi.duration,
    ...doc.events.map((e) => e.startSeconds + e.durationSeconds),
    0,
  );
  return validateDocument(doc);
}
