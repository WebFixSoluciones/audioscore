import { emptyDocument, type MusicDocument } from "@/lib/music/types";
import { secondsToTicks } from "@/lib/music/tempo-map";
import { validateDocument } from "@/lib/music/notation-validation";
import { estimateKey } from "./analysis";
import { isPianoRecording, estimatePianoSplit } from "./refinement";
import type { TranscriptionResult } from "./types";

export function transcriptionDocument(
  result: TranscriptionResult,
  title: string,
  options: { sourceId?: string; tempoMap?: MusicDocument["tempoMap"] } = {},
): MusicDocument {
  const key = estimateKey(result.notes);
  const tempoMap = options.tempoMap ?? [{ startSeconds: 0, ...result.tempo }];
  const sourceId = options.sourceId ?? "audio-transcribed";
  const piano = isPianoRecording(result.instruments);
  const warnings = [
    ...result.warnings,
    "Transcripción automática: revisa notas, octavas y duraciones, especialmente en mezclas con voz o percusión.",
    "El compás 4/4 es una rejilla inicial editable; no se ha detectado el compás con certeza.",
    "Las puntuaciones de notas e instrumentos son activaciones de los modelos, no probabilidades calibradas.",
    "La identificación describe sonidos probables de la mezcla; no separa stems ni atribuye cada nota a un instrumento.",
    "La partitura legible regulariza los ataques y duraciones; MIDI y reproducción conservan los tiempos del audio. El primer ataque se toma como inicio escrito, no como detección de anacrusa.",
    ...(piano
      ? [
          "Los dos pentagramas se asignan por registro; revisa cruces de manos, pedal y voces. La vista legible simplifica el pedal y la duración de acordes; la vista interpretada conserva esas duraciones.",
        ]
      : []),
    result.tempo.confidence
      ? "Tempo estimado por periodicidad del audio; revisa posibles valores al doble o a la mitad."
      : "No se detectó un pulso estable: 120 BPM es una rejilla de referencia editable.",
    key.confidence
      ? "Tonalidad estimada a partir de las notas detectadas; requiere revisión."
      : "No hay evidencia tonal suficiente: C es una referencia editable.",
  ];
  const events = result.notes.map((note, index) => {
    const startTick = secondsToTicks(note.startSeconds, tempoMap);
    return {
      id: `${sourceId.slice(0, 64)}-note-${index}`,
      sourceId,
      type: "note" as const,
      startSeconds: note.startSeconds,
      durationSeconds: note.durationSeconds,
      startTick,
      durationTicks: Math.max(
        1,
        secondsToTicks(note.startSeconds + note.durationSeconds, tempoMap) -
          startTick,
      ),
      midiNote: note.midiNote,
      velocity: Math.max(1, Math.min(127, Math.round(note.activation * 127))),
      confidence: Math.min(0.99, note.activation),
      isHumanReviewed: false,
      articulation: "normal" as const,
      metadata: { model: "Basic Pitch 1.0.1", scoreKind: "activation" },
    };
  });
  let lastEnd = 0,
    polyphonic = false;
  for (const event of events) {
    if (event.startSeconds < lastEnd - 0.03) polyphonic = true;
    lastEnd = Math.max(lastEnd, event.startSeconds + event.durationSeconds);
  }
  return validateDocument({
    ...emptyDocument(),
    title,
    durationSeconds: result.durationSeconds,
    tempoMap,
    key: key.key,
    events,
    sources: events.length
      ? [
          {
            id: sourceId,
            name: "Transcribed audio",
            nameEs: "Audio transcrito",
            category: "tonal",
            family: "Instrumentos de la mezcla sin atribución individual",
            acousticOrElectronic: "unknown",
            analogOrDigital: "unknown",
            polyphony: polyphonic ? "polyphonic" : "monophonic",
            confidence: Math.min(
              0.99,
              events.reduce((sum, event) => sum + event.confidence, 0) /
                events.length,
            ),
            evidence: "detected",
            program: 0,
            notationLayout: piano ? "piano" : "single",
            ...(piano
              ? { notationSplitPitch: estimatePianoSplit(result.notes) }
              : {}),
            channel: 1,
            warnings: [
              "El sonido MIDI de piano es una previsualización; no identifica el instrumento original.",
            ],
          },
        ]
      : [],
    warnings,
    confidence: events.length
      ? events.reduce((sum, event) => sum + event.confidence, 0) / events.length
      : 0,
    provenance: "transcription",
    analysis: {
      engine: "Basic Pitch + YAMNet",
      keyConfidence: key.confidence,
      instrumentPredictions: result.instruments,
      scoreOriginSeconds: result.notes.length
        ? Math.min(...result.notes.map((n) => n.startSeconds))
        : 0,
      excludedNotes: result.excludedNotes ?? [],
    },
  });
}
