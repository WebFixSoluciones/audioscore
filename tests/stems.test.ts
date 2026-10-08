import { describe, expect, it, vi } from "vitest";
import { transcribeStems } from "@/lib/audio/transcription/stems";
import { validateDocument } from "@/lib/music/notation-validation";
import { writeMusicXML } from "@/lib/music/musicxml";
import { writeMidi } from "@/lib/music/midi-writer";
import { Midi } from "@tonejs/midi";
import { fixture } from "./fixtures";
import type { SeparatedStem } from "@/lib/audio/separation";

const stems: SeparatedStem[] = [
  {
    id: "demucs-piano",
    kind: "piano",
    label: "Piano",
    confidence: 0,
    storagePath: "temporary/u/p/stems/job/piano.wav",
    localPath: "piano.wav",
  },
  {
    id: "demucs-guitar",
    kind: "guitar",
    label: "Guitarra",
    confidence: 0,
    storagePath: "temporary/u/p/stems/job/guitar.wav",
    localPath: "guitar.wav",
  },
  {
    id: "demucs-drums",
    kind: "drums",
    label: "Batería",
    confidence: 0,
    storagePath: "temporary/u/p/stems/job/drums.wav",
    localPath: "drums.wav",
  },
];
const global = () => ({ ...fixture(), provenance: "transcription" as const });

describe("transcripción por stems reales", () => {
  it("keeps a weak stem playable without turning leakage into notes", async () => {
    const transcribe = vi.fn();
    const doc = await transcribeStems(
      global(),
      [{ ...stems[0], transcriptionEligible: false }],
      transcribe,
    );
    expect(transcribe).not.toHaveBeenCalled();
    expect(doc.events).toHaveLength(0);
    expect(doc.sources[0].storagePath).toBe(stems[0].storagePath);
    expect(doc.sources[0].warnings.join(" ")).toContain("Señal débil");
  });
  it("transcribe cada stem tonal y conserva batería sin fabricar notas", async () => {
    const transcribe = vi.fn(async (stem: SeparatedStem) => {
      const doc = global();
      // Different note content per file and a different local tempo; merge must use the global map.
      doc.tempoMap[0].bpm = 60;
      doc.events = [
        {
          ...doc.events[0],
          midiNote: stem.kind === "piano" ? 60 : 67,
          startSeconds: 1,
          startTick: 128,
          durationTicks: 64,
        },
      ];
      return doc;
    });
    const doc = await transcribeStems(global(), stems, transcribe);
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(
      doc.events.map((event) => [
        event.sourceId,
        event.midiNote,
        event.startTick,
      ]),
    ).toEqual([
      ["demucs-piano", 60, 256],
      ["demucs-guitar", 67, 256],
    ]);
    expect(doc.sources).toHaveLength(3);
    expect(doc.sources[2]).toMatchObject({
      category: "percussive",
      channel: 10,
      storagePath: stems[2].storagePath,
    });
    expect(doc.events.some((event) => event.sourceId === "demucs-drums")).toBe(
      false,
    );
    expect(
      doc.sources.every(
        (source) =>
          source.analogOrDigital === "unknown" &&
          source.evidence === "estimated",
      ),
    ).toBe(true);
    expect(() => validateDocument(doc)).not.toThrow();
    const xml = writeMusicXML(doc);
    expect(xml).toContain("<part-name>Piano</part-name>");
    expect(xml).toContain("<part-name>Guitarra</part-name>");
    const midi = new Midi(writeMidi(doc));
    expect(
      midi.tracks.flatMap((track) => track.notes.map((note) => note.midi)),
    ).toEqual([60, 67]);
  });
  it("retains a playable source when no reliable notes were detected", async () => {
    const doc = await transcribeStems(global(), [stems[0]], async () => ({
      ...global(),
      events: [],
    }));
    expect(doc.sources).toHaveLength(1);
    expect(doc.events).toHaveLength(0);
    expect(doc.sources[0].warnings).toContain(
      "No se detectaron notas fiables en este stem.",
    );
  });
  it("rejects a stem transcription shifted or cropped relative to the original", async () => {
    await expect(
      transcribeStems(global(), [stems[0]], async () => ({
        ...global(),
        durationSeconds: 5,
      })),
    ).rejects.toThrow("duración");
  });
  it("keeps the residual channel mixed rather than calling it a detected synthesizer", async () => {
    const doc = await transcribeStems(
      global(),
      [{ ...stems[0], kind: "other", label: "Otros sonidos" }],
      async () => global(),
    );
    expect(doc.sources[0].category).toBe("mixed");
    expect(doc.sources[0].acousticOrElectronic).toBe("unknown");
    expect(doc.sources[0].warnings.join(" ")).toContain("residual");
  });
});
