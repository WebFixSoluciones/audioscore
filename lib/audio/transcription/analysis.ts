import type { DetectedNote } from "./types";
import type { MusicDocument } from "@/lib/music/types";

/** Positive changes in the energy envelope, with normalized autocorrelation. */
export function estimateTempo(samples: Float32Array, sampleRate: number) {
  const hop = 512;
  const novelty: number[] = [];
  let previous = 0;
  for (let at = 0; at + hop <= samples.length; at += hop) {
    let squares = 0;
    for (let i = at; i < at + hop; i++) squares += samples[i] ** 2;
    const energy = Math.sqrt(squares / hop);
    novelty.push(Math.max(0, energy - previous));
    previous = energy;
  }
  if (novelty.length < 200) return { bpm: 120, confidence: 0 };
  const mean = novelty.reduce((sum, x) => sum + x, 0) / novelty.length;
  const centered = novelty.map((x) => x - mean);
  let best = { bpm: 120, confidence: 0 };
  for (let bpm = 50; bpm <= 200; bpm++) {
    const lag = Math.round((60 * sampleRate) / (bpm * hop));
    let dot = 0,
      left = 0,
      right = 0;
    for (let i = lag; i < centered.length; i++) {
      dot += centered[i] * centered[i - lag];
      left += centered[i] ** 2;
      right += centered[i - lag] ** 2;
    }
    const correlation = dot / Math.max(1e-12, Math.sqrt(left * right));
    if (correlation > best.confidence) best = { bpm, confidence: correlation };
  }
  return best.confidence < 0.18
    ? { bpm: 120, confidence: 0 }
    : { bpm: best.bpm, confidence: Math.min(0.8, best.confidence) };
}

const major = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const minor = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];
const keys: MusicDocument["key"][] = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];
const minorKeys: MusicDocument["key"][] = [
  "Cm",
  "C#m",
  "Dm",
  "Ebm",
  "Em",
  "Fm",
  "F#m",
  "Gm",
  "G#m",
  "Am",
  "Bbm",
  "Bm",
];

/** Key is an estimate of pitch-class distribution, not a verified harmonic analysis. */
export function estimateKey(notes: DetectedNote[]) {
  const histogram = Array<number>(12).fill(0);
  for (const note of notes)
    histogram[note.midiNote % 12] += note.durationSeconds * note.activation;
  const total = histogram.reduce((sum, x) => sum + x, 0);
  if (!total || histogram.filter((x) => x > total * 0.02).length < 3)
    return { key: "C" as MusicDocument["key"], confidence: 0 };
  const mean = total / 12;
  const candidates: { key: MusicDocument["key"]; score: number }[] = [];
  for (const [profile, names] of [
    [major, keys],
    [minor, minorKeys],
  ] as const) {
    const profileMean = profile.reduce((sum, x) => sum + x, 0) / 12;
    for (let root = 0; root < 12; root++) {
      let dot = 0,
        left = 0,
        right = 0;
      for (let pitch = 0; pitch < 12; pitch++) {
        const a = histogram[pitch] - mean;
        const b = profile[(pitch - root + 12) % 12] - profileMean;
        dot += a * b;
        left += a * a;
        right += b * b;
      }
      candidates.push({
        key: names[root],
        score: dot / Math.max(1e-12, Math.sqrt(left * right)),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return {
    key: candidates[0].key,
    confidence: Math.max(
      0,
      Math.min(
        0.85,
        (candidates[0].score - candidates[1].score) * 2 +
          candidates[0].score * 0.3,
      ),
    ),
  };
}

/** Only join same-pitch continuations clipped at a processing boundary. */
export function appendSegmentNotes(
  destination: DetectedNote[],
  notes: DetectedNote[],
  start: number,
  end: number,
) {
  const byPitch = new Map<number, DetectedNote>();
  for (let i = destination.length - 1; i >= 0; i--) {
    const note = destination[i];
    if (note.startSeconds + note.durationSeconds < start - 0.1) continue;
    if (!byPitch.has(note.midiNote)) byPitch.set(note.midiNote, note);
  }
  for (const raw of notes.sort((a, b) => a.startSeconds - b.startSeconds)) {
    const at = Math.max(start, raw.startSeconds);
    const until = Math.min(end, raw.startSeconds + raw.durationSeconds);
    if (until - at < 0.045) continue;
    const previous = byPitch.get(raw.midiNote);
    if (
      raw.startSeconds < start &&
      previous &&
      Math.abs(previous.startSeconds + previous.durationSeconds - start) < 0.05
    ) {
      previous.durationSeconds = until - previous.startSeconds;
      previous.activation = Math.min(previous.activation, raw.activation);
    } else {
      const note = { ...raw, startSeconds: at, durationSeconds: until - at };
      destination.push(note);
      byPitch.set(note.midiNote, note);
    }
  }
}
