import { describe, it, expect } from "vitest";
import { Midi } from "@tonejs/midi";
import { XMLParser } from "fast-xml-parser";
import {
  secondsToTicks,
  ticksToSeconds,
  beatsToMeasure,
} from "@/lib/music/tempo-map";
import { quantizeEvents } from "@/lib/music/quantization";
import { writeMidi } from "@/lib/music/midi-writer";
import { readMidi } from "@/lib/music/midi-reader";
import { writeMusicXML } from "@/lib/music/musicxml";
import {
  validateDocument,
  validateMusicXML,
  reviewWarnings,
} from "@/lib/music/notation-validation";
import { fixture } from "./fixtures";
describe("tiempo y notación", () => {
  it("integra cambios de tempo sin perder duración", () => {
    const map = [
      { startSeconds: 0, bpm: 120, confidence: 1 },
      { startSeconds: 2, bpm: 60, confidence: 1 },
    ];
    expect(secondsToTicks(3, map)).toBe(640);
    expect(ticksToSeconds(640, map)).toBe(3);
    expect(secondsToTicks(0, map)).toBe(0);
    expect(() =>
      secondsToTicks(1, [{ startSeconds: 1, bpm: 120, confidence: 1 }]),
    ).toThrow();
  });
  it("ubica beats en compases simples y compuestos", () => {
    expect(beatsToMeasure(4, [4, 4])).toEqual({ measure: 2, beat: 1 });
    expect(beatsToMeasure(3, [6, 8])).toEqual({ measure: 2, beat: 1 });
  });
  it("cuantiza una copia y mantiene el original", () => {
    const d = fixture();
    d.events[0].startTick = 13;
    const q = quantizeEvents(d.events, d);
    expect(q[0].startTick).toBe(0);
    expect(d.events[0].startTick).toBe(13);
  });
  it("rechaza eventos huérfanos, negativos, fuera de duración y timing inconsistente", () => {
    const d = fixture();
    expect(() =>
      validateDocument({
        ...d,
        events: [{ ...d.events[0], sourceId: "missing" }],
      }),
    ).toThrow();
    expect(() =>
      validateDocument({ ...d, events: [{ ...d.events[0], startTick: -1 }] }),
    ).toThrow();
    expect(() => validateDocument({ ...d, durationSeconds: 0.1 })).toThrow();
    expect(() =>
      validateDocument({ ...d, events: [{ ...d.events[0], startTick: 120 }] }),
    ).toThrow();
  });
  it("genera MIDI válido y conserva notas, duraciones y velocity", () => {
    const bytes = writeMidi(fixture());
    const parsed = new Midi(bytes);
    expect(parsed.header.ppq).toBe(128);
    const notes = parsed.tracks.flatMap((t) => t.notes);
    expect(notes.map((n) => n.midi)).toEqual([60, 64]);
    expect(notes[1].ticks).toBe(384);
    expect(notes[1].durationTicks).toBe(256);
    expect(notes[0].velocity).toBeCloseTo(100 / 127, 1);
    const imported = readMidi(bytes);
    expect(imported.events).toHaveLength(2);
    expect(imported.sources[0].analogOrDigital).toBe("unknown");
  });
  it("mantiene tempo variable al exportar y volver a leer", () => {
    const doc = fixture();
    doc.tempoMap.push({ startSeconds: 2, bpm: 60, confidence: 1 });
    doc.events[1].durationSeconds = 1.5;
    doc.events[1].durationTicks = 256;
    const parsed = new Midi(writeMidi(doc));
    expect(parsed.header.tempos.map((t) => t.bpm)).toEqual([120, 60]);
    expect(parsed.tracks.flatMap((t) => t.notes)[1].duration).toBeCloseTo(1.5);
  });
  it("genera compases completos y ligaduras al cruzar un compás", () => {
    const xml = writeMusicXML(fixture());
    expect(validateMusicXML(xml)).toBe(true);
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
    const measures = parsed["score-partwise"].part.measure;
    for (const m of measures) {
      const notes = Array.isArray(m.note) ? m.note : [m.note];
      expect(
        notes.reduce(
          (sum: number, n: { duration: number }) => sum + Number(n.duration),
          0,
        ),
      ).toBe(512);
    }
  });
  it("escapa títulos y rechaza entidades XML", () => {
    expect(writeMusicXML({ ...fixture(), title: '<x> & "y"' })).toContain(
      "&lt;x&gt; &amp; &quot;y&quot;",
    );
    expect(() =>
      validateMusicXML('<!ENTITY a "x"><score-partwise/>'),
    ).toThrow();
  });
  it("marca baja confianza y evita exportar fuentes ausentes", () => {
    expect(reviewWarnings(fixture())).toHaveLength(1);
    expect(() => writeMidi(fixture(), "missing")).toThrow();
  });
});
