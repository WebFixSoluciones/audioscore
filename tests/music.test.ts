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
  it("calcula compases y beats dinámicos a partir del mapa de tempo con tempo variable", async () => {
    const { computeBarsAndBeats, getCurrentBarAndBeat } = await import(
      "@/lib/music/tempo-map"
    );
    const dynamicMap = [
      { startSeconds: 0, bpm: 120, confidence: 1 },
      { startSeconds: 4, bpm: 60, confidence: 1 },
    ];
    const bars = computeBarsAndBeats(dynamicMap, 12, [4, 4]);
    expect(bars.length).toBeGreaterThanOrEqual(4);
    expect(bars[0].barNumber).toBe(1);
    expect(bars[0].startSeconds).toBeCloseTo(0, 2);
    expect(bars[0].endSeconds).toBeCloseTo(2, 2);
    expect(bars[0].beats).toHaveLength(4);
    expect(bars[0].beats[0].isDownbeat).toBe(true);
    expect(bars[0].beats[1].isDownbeat).toBe(false);

    expect(bars[1].barNumber).toBe(2);
    expect(bars[1].startSeconds).toBeCloseTo(2, 2);
    expect(bars[1].endSeconds).toBeCloseTo(4, 2);

    expect(bars[2].barNumber).toBe(3);
    expect(bars[2].startSeconds).toBeCloseTo(4, 2);
    expect(bars[2].endSeconds).toBeCloseTo(8, 2);

    const at0 = getCurrentBarAndBeat(0.1, bars);
    expect(at0.barNumber).toBe(1);
    expect(at0.beatNumber).toBe(1);

    const at2p5 = getCurrentBarAndBeat(2.6, bars);
    expect(at2p5.barNumber).toBe(2);
    expect(at2p5.beatNumber).toBe(2);

    const at5 = getCurrentBarAndBeat(5.5, bars);
    expect(at5.barNumber).toBe(3);
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
  it("renderiza letra de canción y cabezas de nota tipo cross (X) para Sound FX", () => {
    const doc = fixture();
    doc.events[0].lyric = "Cantar";
    doc.events[1].notehead = "cross";
    doc.events[1].lyric = "Explosión FX";
    const xml = writeMusicXML(doc);
    expect(validateMusicXML(xml)).toBe(true);
    expect(xml).toContain("<lyric><text>Cantar</text></lyric>");
    expect(xml).toContain("<notehead>cross</notehead>");
    expect(xml).toContain("<lyric><text>Explosión FX</text></lyric>");
  });
});
