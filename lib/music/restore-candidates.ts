import type { MusicDocument } from "./types";
import { secondsToTicks } from "./tempo-map";
import { validateDocument } from "./notation-validation";

export function restoreExcludedNotes(doc: MusicDocument): MusicDocument {
  const source = doc.sources[0];
  if (!source || !doc.analysis?.excludedNotes?.length) return doc;
  const ids = new Set(doc.events.map((e) => e.id));
  const restored = doc.analysis.excludedNotes.map((n, index) => {
    let id = `restored-${index}`;
    while (ids.has(id)) id += "-r";
    ids.add(id);
    const startTick = secondsToTicks(n.startSeconds, doc.tempoMap);
    return {
      id,
      sourceId: source.id,
      type: "note" as const,
      startSeconds: n.startSeconds,
      durationSeconds: n.durationSeconds,
      startTick,
      durationTicks: Math.max(
        1,
        secondsToTicks(n.startSeconds + n.durationSeconds, doc.tempoMap) -
          startTick,
      ),
      midiNote: n.midiNote,
      velocity: Math.max(1, Math.round(n.activation * 127)),
      confidence: n.activation,
      isHumanReviewed: false,
      articulation: "normal" as const,
      metadata: { restoredCandidate: true, reason: n.reason },
    };
  });
  return validateDocument({
    ...doc,
    events: [...doc.events, ...restored].sort(
      (a, b) => a.startSeconds - b.startSeconds,
    ),
    analysis: { ...doc.analysis, excludedNotes: [] },
    warnings: [
      ...doc.warnings,
      `${restored.length} detecciones apartadas recuperadas para revisión.`,
    ],
  });
}
