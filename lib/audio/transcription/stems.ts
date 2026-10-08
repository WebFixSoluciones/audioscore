import { validateDocument } from "@/lib/music/notation-validation";
import { secondsToTicks } from "@/lib/music/tempo-map";
import type { AudioSource, MusicDocument } from "@/lib/music/types";
import type { SeparatedStem } from "@/lib/audio/separation";

const programs = {
  piano: 0,
  guitar: 24,
  bass: 32,
  vocals: 53,
  other: 0,
  unknown: 0,
  drums: 0,
};

export async function transcribeStems(
  global: MusicDocument,
  stems: SeparatedStem[],
  transcribe: (stem: SeparatedStem, index: number) => Promise<MusicDocument>,
): Promise<MusicDocument> {
  const sources: AudioSource[] = [],
    events: MusicDocument["events"] = [];
  const warnings = [
    ...global.warnings.filter(
      (w) => !w.startsWith("La identificación describe"),
    ),
  ];
  for (const [index, stem] of stems.entries()) {
    const source: AudioSource = {
      id: stem.id,
      name: stem.label,
      nameEs: stem.label,
      category:
        stem.kind === "drums"
          ? "percussive"
          : stem.kind === "other" || stem.kind === "unknown"
            ? "mixed"
            : "tonal",
      family: stem.label,
      acousticOrElectronic: "unknown",
      analogOrDigital: "unknown",
      polyphony: "unknown",
      confidence: stem.confidence,
      evidence: "estimated",
      program: programs[stem.kind],
      channel: stem.kind === "drums" ? 10 : (index % 9) + 1,
      notationLayout: stem.kind === "piano" ? "piano" : "single",
      storagePath: stem.storagePath,
      warnings: [
        "Categoría estimada por separación; revisa contaminación entre canales.",
      ],
    };
    // Pitch detection is not a drum classifier. Keep the playable audio without inventing drum notes.
    if (stem.kind === "drums") {
      source.warnings.push(
        "Stem de batería disponible. La transcripción de percusión requiere un motor específico.",
      );
    } else if (stem.transcriptionEligible === false) {
      source.warnings.push(
        "Señal débil: no se transcribieron notas para evitar interpretar filtraciones como un instrumento.",
      );
    } else {
      const doc = validateDocument(await transcribe(stem, index));
      warnings.push(
        ...doc.warnings.map((warning) =>
          `${stem.label}: ${warning}`.slice(0, 1000),
        ),
      );
      if (
        Math.abs(doc.durationSeconds - global.durationSeconds) > 0.05 ||
        doc.provenance !== "transcription"
      )
        throw new Error(
          "La transcripción del stem no conserva la duración del original",
        );
      source.polyphony = doc.sources[0]?.polyphony ?? "unknown";
      if (stem.kind === "piano")
        source.notationSplitPitch = doc.sources[0]?.notationSplitPitch ?? 60;
      for (const [noteIndex, event] of doc.events.entries()) {
        if (event.type !== "note" && event.type !== "chord") continue;
        const startTick = secondsToTicks(event.startSeconds, global.tempoMap);
        events.push({
          ...event,
          id: `${stem.id.slice(0, 64)}-note-${noteIndex}`,
          sourceId: stem.id,
          startTick,
          durationTicks: Math.max(
            1,
            secondsToTicks(
              event.startSeconds + event.durationSeconds,
              global.tempoMap,
            ) - startTick,
          ),
          isHumanReviewed: false,
        });
      }
      if (!doc.events.length)
        source.warnings.push("No se detectaron notas fiables en este stem.");
      if (stem.kind === "other" || stem.kind === "unknown")
        source.warnings.push(
          "Canal residual; puede contener varios instrumentos o sintetizadores sin aislamiento individual.",
        );
    }
    warnings.push(...source.warnings);
    sources.push(source);
  }
  events.sort((a, b) => a.startSeconds - b.startSeconds);
  return validateDocument({
    ...global,
    sources,
    events,
    warnings: [
      ...new Set([
        ...warnings,
        "Notas transcritas desde cada stem tonal con tempo y eje temporal comunes.",
      ]),
    ],
    confidence: events.length
      ? events.reduce((sum, event) => sum + event.confidence, 0) / events.length
      : 0,
    analysis: global.analysis
      ? {
          ...global.analysis,
          engine: "Demucs + Basic Pitch + YAMNet",
          excludedNotes: [],
          scoreOriginSeconds: events[0]?.startSeconds ?? 0,
        }
      : undefined,
  });
}
