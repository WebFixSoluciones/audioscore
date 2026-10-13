import type { TempoChange } from "./types";

/** Eight detected pulses per section suppress frame jitter; these remain estimates. */
export function tempoMapFromBeats(
  beats: number[],
  bpm: number,
  confidence: number,
): TempoChange[] {
  const fallback = [{ startSeconds: 0, bpm, confidence }];
  if (
    confidence < 0.3 ||
    beats.length < 17 ||
    beats.some(
      (beat, i) =>
        !Number.isFinite(beat) || beat < 0 || (i > 0 && beat <= beats[i - 1]),
    )
  )
    return fallback;
  const sections: TempoChange[] = [];
  for (let i = 0; i + 8 < beats.length; i += 8) {
    const rate = 480 / (beats[i + 8] - beats[i]);
    if (rate < 20 || rate > 400 || rate / bpm < 0.5 || rate / bpm > 2)
      return fallback;
    sections.push({
      startSeconds: beats[i],
      bpm: Math.round(rate * 10) / 10,
      confidence: confidence * 0.8,
    });
  }
  const rates = sections.map((s) => s.bpm);
  // Stable pulse should not produce a forest of tempo markings.
  if (Math.max(...rates) / Math.min(...rates) < 1.03) return fallback;
  return [{ ...sections[0], startSeconds: 0 }, ...sections.slice(1)];
}
