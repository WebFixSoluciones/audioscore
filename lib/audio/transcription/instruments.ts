import catalog from "./audioset-catalog.json";
import type { InstrumentPrediction } from "./types";

export const AUDIOSET_MUSICAL_CATEGORY_COUNT = catalog.length;

/** AudioSet taxonomy / translations are CC BY-SA 4.0; see public/models/audioset/LICENSE. */
export function instrumentPredictions(
  scores: number[][],
): InstrumentPrediction[] {
  if (!scores.length) return [];
  const candidates = catalog
    .map((entry) => {
      const values = scores
        .map((frame) => {
          const value = frame[entry.index] ?? 0;
          return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
        })
        .sort((a, b) => b - a);
      const strongest = values.slice(0, 3);
      return {
        ...entry,
        support: values.filter((value) => value >= 0.075).length,
        score:
          strongest.reduce((sum, value) => sum + value, 0) / strongest.length,
      };
    })
    .filter(
      (entry) =>
        entry.score >= 0.1 && entry.support >= Math.min(2, scores.length),
    );
  // A parent and its child describe the same evidence; prefer the specific label.
  return candidates
    .filter(
      (entry) =>
        !candidates.some(
          (child) =>
            entry.descendantIds.includes(child.audiosetId) &&
            child.kind !== "technique",
        ),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((entry) => ({
      label: entry.label,
      labelEs: entry.labelEs,
      score: entry.score,
      audiosetId: entry.audiosetId,
      referenceUrl: entry.referenceUrl,
      kind: entry.kind as InstrumentPrediction["kind"],
    }));
}
