import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { Midi } from "@tonejs/midi";
import {
  resolvePianoPulse,
  refinePianoNotes,
  estimatePianoSplit,
} from "@/lib/audio/transcription/refinement";
import { transcriptionDocument } from "@/lib/audio/transcription/document";
import { restoreExcludedNotes } from "@/lib/music/restore-candidates";
import { writeMusicXML } from "@/lib/music/musicxml";
import { writeMidi } from "@/lib/music/midi-writer";
import { withTempoMap } from "@/lib/music/tempo-map";
import { validateDocument } from "@/lib/music/notation-validation";
import { scoreEvents, scoreOriginTick } from "@/lib/music/score-layout";
import { fixture } from "./fixtures";
import type { DetectedNote } from "@/lib/audio/transcription/types";

const note = (
  startSeconds: number,
  midiNote: number,
  durationSeconds = 0.9,
  activation = 0.8,
): DetectedNote => ({ startSeconds, midiNote, durationSeconds, activation });
describe("refinamiento de piano y notación", () => {
  it("cambia la rejilla de tempo sin mover las notas del audio ni invalidar las exportaciones", () => {
    const original = fixture(),
      changed = withTempoMap(original, [
        { startSeconds: 0, bpm: 85, confidence: 1 },
      ]);
    expect(() => validateDocument(changed)).not.toThrow();
    expect(changed.events[1].startSeconds).toBe(
      original.events[1].startSeconds,
    );
    expect(changed.events[1].durationSeconds).toBe(
      original.events[1].durationSeconds,
    );
    expect(
      new Midi(writeMidi(changed)).tracks.flatMap((t) => t.notes)[1].time,
    ).toBeCloseTo(1.5, 2);
    expect(writeMusicXML(changed)).toContain("<per-minute>85</per-minute>");
    expect(original.tempoMap[0].bpm).toBe(120);
  });
  it("resuelve el pulso de corcheas sin dividir una melodía que ya marca negras", () => {
    const slow = Array.from({ length: 20 }, (_, i) => [
      note(1 + i, 72),
      note(1 + i, 48, 0.45),
      note(1.5 + i, 55, 0.45),
    ]).flat();
    expect(
      resolvePianoPulse({ bpm: 120, confidence: 0.4 }, slow).bpm,
    ).toBeCloseTo(60);
    const fast = slow.map((n) => ({
      ...n,
      startSeconds: n.startSeconds / 2,
      durationSeconds: n.durationSeconds / 2,
    }));
    expect(resolvePianoPulse({ bpm: 120, confidence: 0.4 }, fast).bpm).toBe(
      120,
    );
    expect(
      resolvePianoPulse({ bpm: 120, confidence: 0 }, slow).confidence,
    ).toBe(0);
  });
  it("aparta candidatos débiles concurrentes, conserva notas suaves aisladas y octavas claras", () => {
    const raw = [
      note(0, 48, 1, 0.9),
      note(0.02, 60, 0.15, 0.35),
      note(0, 72, 1, 0.8),
      note(2, 67, 0.15, 0.3),
      note(0.5, 55, 0.4, 0.4),
    ];
    const before = structuredClone(raw),
      refined = refinePianoNotes(raw);
    expect(refined.excludedNotes.map((n) => n.midiNote)).toEqual([60]);
    expect(refined.notes.map((n) => n.midiNote)).toEqual([48, 72, 55, 67]);
    expect(raw).toEqual(before);
    expect(
      estimatePianoSplit(
        Array.from({ length: 10 }, (_, i) => [
          note(i, 51),
          note(i, 58),
          note(i, 70),
        ]).flat(),
      ),
    ).toBeGreaterThan(58);
  });
  it("recupera notas apartadas sin duplicarlas ni inventar revisión humana", () => {
    const doc = transcriptionDocument(
      {
        notes: [note(1, 60)],
        excludedNotes: [
          { ...note(1, 72, 0.15, 0.35), reason: "Armónico candidato" },
        ],
        durationSeconds: 3,
        tempo: { bpm: 60, confidence: 0.5 },
        instruments: [{ label: "Piano", labelEs: "Piano", score: 0.8 }],
        warnings: [],
      },
      "Piano",
    );
    const restored = restoreExcludedNotes(doc);
    expect(restored.events).toHaveLength(2);
    expect(restored.events.every((e) => !e.isHumanReviewed)).toBe(true);
    expect(restoreExcludedNotes(restored)).toEqual(restored);
    expect(doc.events).toHaveLength(1);
    expect(restored.events[1].startSeconds).toBe(1);
  });
  it("escribe dos pentagramas con acordes, ligaduras y compases completos por voz", () => {
    const doc = fixture();
    doc.sources[0].notationLayout = "piano";
    doc.events.push({ ...doc.events[1], id: "bass", midiNote: 48 });
    doc.events.push({ ...doc.events[1], id: "chord", midiNote: 67 });
    const before = structuredClone(doc),
      xml = writeMusicXML(doc);
    expect(xml).toContain("<staves>2</staves>");
    expect(xml).toContain('<clef number="2"><sign>F</sign>');
    expect(xml).toContain("<chord/>");
    expect(xml).toContain('<tie type="start"/>');
    const measures = xml.match(/<measure\b[\s\S]*?<\/measure>/g)!;
    for (const m of measures) {
      const sums = new Map<string, number>();
      for (const n of m.match(/<note\b[\s\S]*?<\/note>/g)!) {
        expect(n).toContain("<type>");
        if (n.includes("<chord/>")) continue;
        const voice = n.match(/<voice>(\d+)<\/voice>/)![1];
        sums.set(
          voice,
          (sums.get(voice) ?? 0) +
            Number(n.match(/<duration>(\d+)<\/duration>/)![1]),
        );
      }
      expect([...sums.values()].every((sum) => sum === 512)).toBe(true);
    }
    expect(doc).toEqual(before);
  });
  it("respeta alteraciones de la armadura y la octava de notas enarmónicas", () => {
    const doc = fixture();
    doc.key = "F#";
    doc.events[0].midiNote = 65;
    expect(writeMusicXML(doc)).toContain(
      "<step>E</step><alter>1</alter><octave>4</octave>",
    );
    doc.key = "Gb";
    doc.events[0].midiNote = 59;
    expect(writeMusicXML(doc)).toContain(
      "<step>C</step><alter>-1</alter><octave>4</octave>",
    );
  });
  it("regulariza sólo la partitura y conserva el ataque de audio en MIDI", () => {
    const doc = transcriptionDocument(
      {
        notes: [note(1.02, 66, 1), note(1.04, 51, 0.9), note(1.52, 58, 0.48)],
        durationSeconds: 3,
        tempo: { bpm: 60, confidence: 0.5 },
        instruments: [{ label: "Piano", labelEs: "Piano", score: 0.8 }],
        warnings: [],
      },
      "Piano",
    );
    expect(scoreOriginTick(doc)).toBe(doc.events[0].startTick);
    expect(scoreEvents(doc, doc.sources[0], true)[0].startTick).toBe(0);
    const before = JSON.stringify(doc),
      xml = writeMusicXML(doc);
    expect(
      new XMLParser().parse(xml)["score-partwise"].part.measure,
    ).toBeTruthy();
    const midi = new Midi(writeMidi(doc));
    expect(midi.tracks.flatMap((t) => t.notes)[0].time).toBeCloseTo(1.02, 2);
    expect(JSON.stringify(doc)).toBe(before);
    // Human-reviewed sustains and the performed view retain overlapping durations.
    doc.events[1].isHumanReviewed = true;
    expect(
      scoreEvents(doc, doc.sources[0], true).find(
        (e) => e.id === doc.events[1].id,
      )!.durationTicks,
    ).toBe(128);
    expect(
      scoreEvents(doc, doc.sources[0], false).find(
        (e) => e.id === doc.events[1].id,
      )!.durationTicks,
    ).toBe(doc.events[1].durationTicks);
  });
});
