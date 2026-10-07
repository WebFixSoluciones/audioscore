import * as tf from "@tensorflow/tfjs";
import {
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch";
import { appendSegmentNotes, estimateTempo } from "./analysis";
import { instrumentPredictions } from "./instruments";
import {
  isPianoRecording,
  refinePianoNotes,
  resolvePianoPulse,
} from "./refinement";
import {
  TRANSCRIPTION_SAMPLE_RATE as RATE,
  type DetectedNote,
  type TranscriptionProgress,
  type TranscriptionResult,
} from "./types";

export async function inferAudio(
  samples: Float32Array,
  pitchModel: tf.GraphModel,
  instrumentModel: tf.GraphModel | undefined,
  report: (value: TranscriptionProgress) => void,
): Promise<TranscriptionResult> {
  if (!samples.length || samples.some((x) => !Number.isFinite(x)))
    throw new Error("Audio vacío o no válido.");
  let energy = 0;
  for (const x of samples) energy += x * x;
  const globalRms = Math.sqrt(energy / samples.length);
  if (globalRms < 0.00001)
    throw new Error("El audio está en silencio. No se detectaron notas.");
  const durationSeconds = samples.length / RATE;
  const rms = (start: number, end: number) => {
    let energy = 0;
    for (let i = Math.max(0, start); i < Math.min(samples.length, end); i++)
      energy += samples[i] ** 2;
    return Math.sqrt(
      energy / Math.max(1, Math.min(samples.length, end) - Math.max(0, start)),
    );
  };
  let loudestWindow = 0;
  for (let start = 0; start < samples.length; start += Math.floor(RATE / 10))
    loudestWindow = Math.max(
      loudestWindow,
      rms(start, start + Math.floor(RATE / 10)),
    );
  const audibleFloor = Math.max(0.00001, loudestWindow * 0.02);
  const basicPitch = new BasicPitch(Promise.resolve(pitchModel));
  const notes: DetectedNote[] = [];
  const span = RATE * 12,
    overlap = RATE;
  for (let core = 0; core < samples.length; core += span) {
    const start = Math.max(0, core - overlap);
    const end = Math.min(samples.length, core + span + overlap);
    if (rms(start, end) < audibleFloor) continue;
    const frames: number[][] = [],
      onsets: number[][] = [];
    // Upstream retains intermediate tensors; isolate each bounded segment's allocations.
    tf.engine().startScope();
    try {
      await basicPitch.evaluateModel(
        samples.slice(start, end),
        (f, o) => {
          frames.push(...f);
          onsets.push(...o);
        },
        (fraction) =>
          report({
            stage: "Detectando notas y acordes",
            progress:
              15 +
              70 *
                Math.min(
                  1,
                  (core + fraction * Math.min(span, samples.length - core)) /
                    samples.length,
                ),
          }),
      );
      const detected = noteFramesToTime(
        outputToNotesPoly(frames, onsets, 0.5, 0.3, 7),
      );
      appendSegmentNotes(
        notes,
        detected
          .map((note) => ({
            startSeconds: note.startTimeSeconds + start / RATE,
            durationSeconds: note.durationSeconds,
            midiNote: note.pitchMidi,
            activation: Math.max(0, Math.min(1, note.amplitude)),
          }))
          .filter(
            (note) =>
              rms(
                Math.floor(note.startSeconds * RATE),
                Math.ceil((note.startSeconds + note.durationSeconds) * RATE),
              ) >= audibleFloor,
          ),
        core / RATE,
        Math.min(samples.length, core + span) / RATE,
      );
    } finally {
      tf.engine().endScope();
    }
    if (notes.length > 10000)
      throw new Error(
        "Hay más de 10 000 notas. Selecciona una región más corta para transcribir.",
      );
  }
  report({ stage: "Estimando tempo e instrumentos", progress: 87 });
  const warnings: string[] = [];
  const scores: number[][] = [];
  if (instrumentModel) {
    // Cover the whole audio with bounded tensors. Discard context-only rows
    // so overlapping context does not count as independent evidence.
    const windows = Math.max(1, Math.ceil(durationSeconds / 3));
    for (let i = 0; i < windows; i++) {
      const start = i * RATE * 3;
      const input = new Float32Array(61440);
      if (rms(start, Math.min(samples.length, start + RATE * 3)) < audibleFloor)
        continue;
      for (let j = 0; j < input.length; j++) {
        const at = start + (j * RATE) / 16000;
        const floor = Math.floor(at),
          fraction = at - floor;
        input[j] =
          (samples[floor] ?? 0) * (1 - fraction) +
          (samples[floor + 1] ?? 0) * fraction;
      }
      tf.engine().startScope();
      try {
        const prediction = await instrumentModel.executeAsync(
          tf.tensor1d(input),
        );
        const outputs = Array.isArray(prediction) ? prediction : [prediction];
        const output = outputs.find((tensor) => tensor.shape.at(-1) === 521);
        if (!output)
          throw new Error("El clasificador no entregó etiquetas válidas.");
        const rows = (await output.array()) as number[][];
        scores.push(
          ...rows.filter(
            (_, frame) =>
              frame * 0.48 < 3 && start / RATE + frame * 0.48 < durationSeconds,
          ),
        );
      } catch {
        warnings.push(
          "No se pudo completar la identificación de instrumentos; no se asignaron etiquetas inventadas.",
        );
        break;
      } finally {
        tf.engine().endScope();
      }
      report({
        stage: "Comparando patrones de instrumentos con AudioSet",
        progress: 87 + ((i + 1) / windows) * 8,
      });
    }
  } else warnings.push("El modelo de instrumentos no está disponible.");
  if (!notes.length)
    warnings.push(
      "No se detectaron notas tonales con suficiente activación. La percusión y el ruido no se convierten automáticamente en notas.",
    );
  const instruments = instrumentPredictions(scores);
  const piano = isPianoRecording(instruments);
  const refined = piano
    ? refinePianoNotes(notes)
    : { notes, excludedNotes: [] };
  const tempo = estimateTempo(samples, RATE);
  if (refined.excludedNotes.length)
    warnings.push(
      `${refined.excludedNotes.length} detecciones débiles apartadas; puedes recuperarlas para revisarlas.`,
    );
  return {
    notes: refined.notes.sort(
      (a, b) => a.startSeconds - b.startSeconds || a.midiNote - b.midiNote,
    ),
    durationSeconds,
    excludedNotes: refined.excludedNotes,
    tempo: piano ? resolvePianoPulse(tempo, refined.notes) : tempo,
    instruments,
    warnings,
  };
}
