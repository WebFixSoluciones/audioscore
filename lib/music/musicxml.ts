import { PPQ, type MusicDocument, type MusicalEvent } from "./types";
import { secondsToTicks } from "./tempo-map";
import { validateDocument, validateMusicXML } from "./notation-validation";
import { scoreEvents, scoreOriginTick, scoreVoices } from "./score-layout";
export const escapeXml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const fifths: Record<string, number> = {
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  "F#": 6,
  F: -1,
  Bb: -2,
  Eb: -3,
  Ab: -4,
  Db: -5,
  Gb: -6,
  Am: 0,
  Em: 1,
  Bm: 2,
  Dm: -1,
  Gm: -2,
  Cm: -3,
  "C#m": 4,
  Ebm: -6,
  Fm: -4,
  "F#m": 3,
  "G#m": 5,
  Bbm: -5,
};
const naturals: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
function pitchXml(pitch: number, key: string) {
  const count = fifths[key],
    order =
      count >= 0
        ? ["F", "C", "G", "D", "A", "E", "B"]
        : ["B", "E", "A", "D", "G", "C", "F"];
  const alterations = Object.fromEntries(
    order
      .slice(0, Math.abs(count))
      .map((letter) => [letter, count >= 0 ? 1 : -1]),
  );
  let spelling = Object.entries(naturals)
    .map(([step, base]) => ({ step, base, alter: alterations[step] ?? 0 }))
    .find((n) => (n.base + n.alter + 12) % 12 === pitch % 12);
  if (!spelling) {
    const names =
      count < 0
        ? ["C", "D", "D", "E", "E", "F", "G", "G", "A", "A", "B", "B"]
        : ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
    const step = names[pitch % 12],
      base = naturals[step];
    spelling = { step, base, alter: (pitch % 12) - base };
  }
  return `<pitch><step>${spelling.step}</step>${spelling.alter ? `<alter>${spelling.alter}</alter>` : ""}<octave>${Math.floor((pitch - spelling.base - spelling.alter) / 12) - 1}</octave></pitch>`;
}
const durationValues = [
  [PPQ * 4, "whole"],
  [PPQ * 2, "half"],
  [PPQ, "quarter"],
  [PPQ / 2, "eighth"],
  [PPQ / 4, "16th"],
  [PPQ / 8, "32nd"],
  [PPQ / 16, "64th"],
  [PPQ / 32, "128th"],
  [PPQ / 64, "256th"],
  [PPQ / 128, "512th"],
] as const;
function durationPieces(ticks: number, at: number) {
  const pieces: { ticks: number; type: string; dot: boolean }[] = [];
  while (ticks > 0) {
    const beatRemainder = PPQ - (at % PPQ);
    const limit = at % PPQ && ticks > beatRemainder ? beatRemainder : ticks;
    const choices = durationValues
      .flatMap(([value, type]) => [
        { ticks: value, type, dot: false },
        ...(Number.isInteger(value * 1.5)
          ? [{ ticks: value * 1.5, type, dot: true }]
          : []),
      ])
      .sort((a, b) => b.ticks - a.ticks);
    const piece = choices.find((p) => p.ticks <= limit)!;
    pieces.push(piece);
    ticks -= piece.ticks;
    at += piece.ticks;
  }
  return pieces;
}
function noteXml(
  e: MusicalEvent | undefined,
  duration: number,
  voice: number,
  before: boolean,
  after: boolean,
  staff: number,
  key: string,
  at: number,
) {
  const pitches = e?.pitches ?? (e?.midiNote === undefined ? [] : [e.midiNote]);
  const pieces = durationPieces(duration, at);
  return pieces
    .map((piece, index) => {
      const type = `<type>${piece.type}</type>${piece.dot ? "<dot/>" : ""}`;
      if (!pitches.length || e?.type === "rest")
        return `<note><rest/><duration>${piece.ticks}</duration><voice>${voice}</voice>${type}<staff>${staff}</staff></note>`;
      const stop = before || index > 0,
        start = after || index < pieces.length - 1;
      return pitches
        .map(
          (p, i) =>
            `<note color="${e!.confidence < 0.7 && !e!.isHumanReviewed ? "#EA9A49" : "#222222"}">${i ? "<chord/>" : ""}${pitchXml(p, key)}<duration>${piece.ticks}</duration>${stop ? '<tie type="stop"/>' : ""}${start ? '<tie type="start"/>' : ""}<voice>${voice}</voice>${type}<staff>${staff}</staff>${stop || start || e!.articulation !== "normal" ? `<notations>${stop ? '<tied type="stop"/>' : ""}${start ? '<tied type="start"/>' : ""}${e!.articulation !== "normal" ? `<articulations><${e!.articulation}/></articulations>` : ""}</notations>` : ""}</note>`,
        )
        .join("");
    })
    .join("");
}
export function writeMusicXML(
  input: MusicDocument,
  sourceId?: string,
  options: { readable?: boolean } = {},
): string {
  const doc = validateDocument(input);
  const sources = doc.sources.filter((s) => !sourceId || s.id === sourceId);
  if (!sources.length) throw new Error("No hay instrumentos para la partitura");
  const measureTicks = (doc.timeSignature[0] * PPQ * 4) / doc.timeSignature[1];
  const readable = options.readable ?? true;
  const prepared = new Map(
    sources.map((s) => [s.id, scoreEvents(doc, s, readable)]),
  );
  const origin = scoreOriginTick(doc);
  const total = Math.max(
    ...(doc.provenance === "transcription"
      ? []
      : [secondsToTicks(doc.durationSeconds, doc.tempoMap)]),
    ...sources.flatMap((s) =>
      prepared.get(s.id)!.map((e) => e.startTick + e.durationTicks),
    ),
    measureTicks,
  );
  const measures = Math.ceil(total / measureTicks);
  if (measures > 3000) throw new Error("Partitura demasiado extensa");
  const partList = sources
    .map(
      (s, i) =>
        `<score-part id="P${i + 1}"><part-name>${escapeXml(s.nameEs || s.name)}</part-name><score-instrument id="I${i + 1}"><instrument-name>${escapeXml(s.name)}</instrument-name></score-instrument><midi-instrument id="I${i + 1}"><midi-channel>${s.category === "percussive" ? 10 : s.channel}</midi-channel><midi-program>${s.program + 1}</midi-program></midi-instrument></score-part>`,
    )
    .join("");
  const parts = sources
    .map((s, index) => {
      const staves = s.notationLayout === "piano" ? 2 : 1;
      const voices = Array.from({ length: staves }, (_, i) =>
        scoreVoices(prepared.get(s.id)!, i + 1).map((events) => ({
          events,
          staff: i + 1,
        })),
      ).flat();
      return `<part id="P${index + 1}">${Array.from(
        { length: measures },
        (_, m) => {
          const start = m * measureTicks,
            end = start + measureTicks;
          const attributes =
            m === 0
              ? `<attributes><divisions>${PPQ}</divisions><key><fifths>${fifths[doc.key]}</fifths><mode>${doc.key.endsWith("m") ? "minor" : "major"}</mode></key><time><beats>${doc.timeSignature[0]}</beats><beat-type>${doc.timeSignature[1]}</beat-type></time>${staves === 2 ? '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>' : `<clef><sign>${s.program >= 32 && s.program <= 39 ? "F" : "G"}</sign><line>${s.program >= 32 && s.program <= 39 ? 4 : 2}</line></clef>`}</attributes>`
              : "";
          const tempos = doc.tempoMap
            .filter((t) => {
              const tick = Math.max(
                0,
                secondsToTicks(t.startSeconds, doc.tempoMap) - origin,
              );
              return tick >= start && tick < end;
            })
            .map(
              (t) =>
                `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${t.bpm}</per-minute></metronome></direction-type><offset>${Math.max(0, secondsToTicks(t.startSeconds, doc.tempoMap) - origin) - start}</offset><sound tempo="${t.bpm}"/></direction>`,
            )
            .join("");
          const body = voices
            .map(({ events, staff }, v) => {
              let cursor = start;
              let xml =
                v > 0
                  ? `<backup><duration>${measureTicks}</duration></backup>`
                  : "";
              for (const e of events.filter(
                (e) =>
                  e.startTick < end && e.startTick + e.durationTicks > start,
              )) {
                const at = Math.max(start, e.startTick),
                  until = Math.min(end, e.startTick + e.durationTicks);
                if (at > cursor)
                  xml += noteXml(
                    undefined,
                    at - cursor,
                    v + 1,
                    false,
                    false,
                    staff,
                    doc.key,
                    cursor - start,
                  );
                xml += noteXml(
                  e,
                  until - at,
                  v + 1,
                  e.startTick < start,
                  e.startTick + e.durationTicks > end,
                  staff,
                  doc.key,
                  at - start,
                );
                cursor = until;
              }
              if (cursor < end)
                xml += noteXml(
                  undefined,
                  end - cursor,
                  v + 1,
                  false,
                  false,
                  staff,
                  doc.key,
                  cursor - start,
                );
              return xml;
            })
            .join("");
          return `<measure number="${m + 1}">${attributes}${tempos}${body}</measure>`;
        },
      ).join("")}</part>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>${escapeXml(doc.title)}</work-title></work><identification><creator type="composer">AudioScore AI · ${doc.provenance}</creator></identification><part-list>${partList}</part-list>${parts}</score-partwise>`;
  validateMusicXML(xml);
  return xml;
}
