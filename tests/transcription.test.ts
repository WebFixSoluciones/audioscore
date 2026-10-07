import { describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { writeFile, readFile } from "node:fs/promises";
import { join, dirname, sep } from "node:path";
import { createRequire } from "node:module";
import {
  appendSegmentNotes,
  estimateTempo,
} from "@/lib/audio/transcription/analysis";
import { transcriptionDocument } from "@/lib/audio/transcription/document";
import { instrumentPredictions } from "@/lib/audio/transcription/instruments";
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from "@/lib/utils/temporary-directory";
import type {
  TranscriptionResult,
  TranscriptionWorkerMessage,
} from "@/lib/audio/transcription/types";
import { musicalAudioFixture } from "./audio-fixtures";

describe("transcripción integrada", () => {
  it("une continuaciones de segmento sin unir notas nuevas del mismo pitch", () => {
    const notes = [
      { startSeconds: 11, durationSeconds: 1, midiNote: 60, activation: 0.8 },
    ];
    appendSegmentNotes(
      notes,
      [
        {
          startSeconds: 11.5,
          durationSeconds: 1.5,
          midiNote: 60,
          activation: 0.7,
        },
        {
          startSeconds: 13.1,
          durationSeconds: 0.4,
          midiNote: 60,
          activation: 0.8,
        },
      ],
      12,
      24,
    );
    expect(notes).toHaveLength(2);
    expect(notes[0].durationSeconds).toBe(2);
  });
  it("declara ausencia de tempo en silencio en vez de detectarlo", () => {
    expect(estimateTempo(new Float32Array(22050 * 8), 22050)).toEqual({
      bpm: 120,
      confidence: 0,
    });
  });
  it("conserva la incertidumbre cuando no hay notas", () => {
    const doc = transcriptionDocument(
      {
        notes: [],
        durationSeconds: 5,
        tempo: { bpm: 120, confidence: 0 },
        instruments: [],
        warnings: [],
      },
      "Silencio",
    );
    expect(doc.events).toHaveLength(0);
    expect(doc.sources).toHaveLength(0);
    expect(doc.tempoMap[0].confidence).toBe(0);
    expect(doc.analysis?.keyConfidence).toBe(0);
  });
  it("las etiquetas del clasificador coinciden con el mapa oficial", async () => {
    const classes = JSON.parse(
      await readFile(
        join(process.cwd(), "public/models/yamnet/classes.json"),
        "utf8",
      ),
    ) as { index: number; label: string }[];
    for (const entry of classes) {
      const scores = Array<number>(521).fill(0);
      scores[entry.index] = 0.8;
      for (const prediction of instrumentPredictions([scores]))
        expect(prediction.label).toBe(entry.label);
    }
  });
  it("ejecuta los modelos reales y detecta las alturas de un acorde y una melodía", async () => {
    const folder = await createTemporaryDirectory("test");
    try {
      const fixture = musicalAudioFixture(),
        pcmPath = join(folder, "known-audio.pcm");
      await writeFile(
        pcmPath,
        Buffer.concat([fixture.pcm, fixture.pcm, fixture.pcm]),
      );
      const require = createRequire(import.meta.url);
      const result = await new Promise<TranscriptionResult>(
        (resolve, reject) => {
          const worker = new Worker(
            join(process.cwd(), "runtime/transcription-worker.cjs"),
            {
              workerData: {
                pcmPath,
                modelsDirectory: join(process.cwd(), "public/models"),
                wasmDirectory:
                  dirname(
                    require.resolve("@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm"),
                  ) + sep,
              },
            },
          );
          const timer = setTimeout(() => {
            void worker.terminate();
            reject(new Error("Model inference timeout"));
          }, 150000);
          worker.on("message", (message: TranscriptionWorkerMessage) => {
            if (message.type === "complete") {
              clearTimeout(timer);
              void worker.terminate();
              resolve(message.result);
            }
            if (message.type === "error") {
              clearTimeout(timer);
              void worker.terminate();
              reject(new Error(message.message));
            }
          });
          worker.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
        },
      );
      const pitches = result.notes.map((note) => note.midiNote);
      for (const pitch of fixture.expectedPitches)
        expect(pitches).toContain(pitch);
      expect(result.durationSeconds).toBeCloseTo(fixture.duration * 3, 2);
      expect(result.notes.some((note) => note.startSeconds > 15)).toBe(true);
      const acrossBoundary = result.notes.find(
        (note) =>
          note.midiNote === 60 && Math.abs(note.startSeconds - 11.2) < 0.15,
      );
      expect(acrossBoundary?.durationSeconds).toBeGreaterThan(0.8);
      expect(result.warnings).not.toContain(
        "No se pudo completar la identificación de instrumentos; no se asignaron etiquetas inventadas.",
      );
      const doc = transcriptionDocument(result, "Prueba real");
      expect(doc.provenance).toBe("transcription");
      expect(doc.events.every((event) => !event.isHumanReviewed)).toBe(true);
      expect(doc.sources[0].analogOrDigital).toBe("unknown");
    } finally {
      await removeTemporaryDirectory(folder);
    }
  }, 180000);
});
