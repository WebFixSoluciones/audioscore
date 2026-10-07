import type { InstrumentPrediction } from "./types";
const labels: Record<number, [string, string]> = {
  24: ["Singing", "Voz cantada"],
  135: ["Guitar", "Guitarra"],
  136: ["Electric guitar", "Guitarra eléctrica"],
  137: ["Bass guitar", "Bajo"],
  138: ["Acoustic guitar", "Guitarra acústica"],
  142: ["Banjo", "Banjo"],
  143: ["Sitar", "Sitar"],
  144: ["Mandolin", "Mandolina"],
  146: ["Ukulele", "Ukelele"],
  148: ["Piano", "Piano"],
  149: ["Electric piano", "Piano eléctrico"],
  150: ["Organ", "Órgano"],
  153: ["Synthesizer", "Sintetizador"],
  154: ["Sampler", "Sampler"],
  155: ["Harpsichord", "Clave"],
  157: ["Drum kit", "Batería"],
  158: ["Drum machine", "Caja de ritmos"],
  159: ["Drum", "Tambor"],
  164: ["Timpani", "Timbales"],
  165: ["Tabla", "Tabla"],
  166: ["Cymbal", "Platillos"],
  175: ["Marimba, xylophone", "Marimba o xilófono"],
  177: ["Vibraphone", "Vibráfono"],
  182: ["Trumpet", "Trompeta"],
  183: ["Trombone", "Trombón"],
  186: ["Violin, fiddle", "Violín"],
  188: ["Cello", "Violonchelo"],
  189: ["Double bass", "Contrabajo"],
  191: ["Flute", "Flauta"],
  192: ["Saxophone", "Saxofón"],
  193: ["Clarinet", "Clarinete"],
  194: ["Harp", "Arpa"],
  195: ["Bell", "Campana"],
  204: ["Accordion", "Acordeón"],
};
export function instrumentPredictions(
  scores: number[][],
): InstrumentPrediction[] {
  if (!scores.length) return [];
  return Object.entries(labels)
    .map(([index, [label, labelEs]]) => {
      const values = scores
        .map((frame) => frame[Number(index)] ?? 0)
        .sort((a, b) => b - a);
      const strongest = values.slice(0, Math.min(3, values.length));
      return {
        label,
        labelEs,
        support: values.filter((score) => score >= 0.075).length,
        score: Math.max(
          0,
          Math.min(
            1,
            strongest.reduce((sum, score) => sum + score / strongest.length, 0),
          ),
        ),
      };
    })
    .filter(
      (prediction) =>
        prediction.score >= 0.1 &&
        prediction.support >= Math.min(2, scores.length),
    )
    .map(({ label, labelEs, score }) => ({ label, labelEs, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}
