import { XMLParser, XMLValidator } from "fast-xml-parser";
import { documentSchema, type MusicDocument } from "./types";
import { secondsToTicks, validateTempoMap } from "./tempo-map";
export function validateDocument(input: unknown): MusicDocument {
  const doc = documentSchema.parse(input);
  validateTempoMap(doc.tempoMap);
  if ((doc.analysis?.scoreOriginSeconds ?? 0) > doc.durationSeconds)
    throw new Error("Inicio escrito fuera del audio");
  for (const n of doc.analysis?.excludedNotes ?? [])
    if (n.startSeconds + n.durationSeconds > doc.durationSeconds + 0.02)
      throw new Error("Detección apartada fuera del audio");
  const ids = new Set(doc.sources.map((s) => s.id));
  if (
    ids.size !== doc.sources.length ||
    new Set(doc.events.map((e) => e.id)).size !== doc.events.length
  )
    throw new Error("Identificadores duplicados");
  for (const e of doc.events) {
    if (!ids.has(e.sourceId)) throw new Error("Fuente inexistente");
    if (e.startSeconds + e.durationSeconds > doc.durationSeconds + 0.02)
      throw new Error("Evento fuera de la duración");
    if (
      Math.abs(secondsToTicks(e.startSeconds, doc.tempoMap) - e.startTick) >
        2 ||
      Math.abs(
        secondsToTicks(e.startSeconds + e.durationSeconds, doc.tempoMap) -
          e.startTick -
          e.durationTicks,
      ) > 2
    )
      throw new Error("Timing inconsistente entre segundos y ticks");
  }
  for (const s of doc.sections)
    if (s.endSeconds <= s.startSeconds || s.endSeconds > doc.durationSeconds)
      throw new Error("Sección fuera del audio");
  return doc;
}
export function validateMusicXML(xml: string) {
  if (
    xml.length > 10_000_000 ||
    /<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new Error("MusicXML inválido");
  const root = new XMLParser({ ignoreAttributes: false }).parse(xml)[
    "score-partwise"
  ];
  if (!root?.["part-list"] || !root.part)
    throw new Error("MusicXML sin partes");
  return true;
}
export function reviewWarnings(doc: MusicDocument): string[] {
  return [
    ...doc.warnings,
    ...(doc.events.some((e) => e.confidence < 0.7 && !e.isHumanReviewed)
      ? ["Hay eventos de baja confianza pendientes de revisión."]
      : []),
    ...(!doc.events.length
      ? [
          "No hay eventos transcritos; no se puede entregar una partitura musical.",
        ]
      : []),
    ...(doc.sources.some(
      (s) => s.analogOrDigital !== "unknown" && s.evidence !== "human",
    )
      ? [
          "La procedencia analógica/digital es una inferencia que requiere evidencia externa.",
        ]
      : []),
  ];
}
