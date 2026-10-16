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
            `<note color="${e!.confidence < 0.7 && !e!.isHumanReviewed ? "#EA9A49" : "#222222"}">${i ? "<chord/>" : ""}${pitchXml(p, key)}<duration>${piece.ticks}</duration>${stop ? '<tie type="stop"/>' : ""}${start ? '<tie type="start"/>' : ""}<voice>${voice}</voice>${type}<staff>${staff}</staff>${e!.notehead ? `<notehead>${e!.notehead === "x" ? "cross" : e!.notehead}</notehead>` : ""}${e!.lyric && !i && !index ? `<lyric><text>${escapeXml(e!.lyric)}</text></lyric>` : ""}${stop || start || e!.articulation !== "normal" ? `<notations>${stop ? '<tied type="stop"/>' : ""}${start ? '<tied type="start"/>' : ""}${e!.articulation !== "normal" ? `<articulations><${e!.articulation}/></articulations>` : ""}</notations>` : ""}</note>`,
        )
        .join("");
    })
    .join("");
}
export function writeMusicXML(
  input: MusicDocument | ScoreDocumentDefinition,
  sourceId?: string,
  options: { readable?: boolean } = {},
): string {
  if ("parts" in input && Array.isArray((input as ScoreDocumentDefinition).parts)) {
    return writeMusicXMLFromScoreDefinition(input as ScoreDocumentDefinition);
  }
  const doc = validateDocument(input as MusicDocument);
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

export type MidiPortLetter = "A" | "B" | "C" | "D";

export interface InstrumentTransposition {
  diatonic: number;
  chromatic: number;
  octaveChange?: number;
}

export interface ScoreNoteEvent {
  startDivisions: number;
  durationDivisions: number;
  voice?: number;
  type: "whole" | "half" | "quarter" | "eighth" | "16th";
  staff?: number;
  unpitched?: boolean;
  step?: "C" | "D" | "E" | "F" | "G" | "A" | "B";
  alter?: number;
  octave?: number;
  displayStep?: "C" | "D" | "E" | "F" | "G" | "A" | "B";
  displayOctave?: number;
  notehead?: "normal" | "cross" | "diamond" | "triangle" | "slash";
  articulation?: "staccato" | "accent" | "tenuto";
  lyricText?: string;
  syllabic?: "single" | "begin" | "middle" | "end";
}

export interface ScorePartDefinition {
  id: string;
  name: string;
  abbreviation?: string;
  family: "woodwinds" | "brass" | "strings" | "percussion" | "choir" | "vocals" | "fx";
  globalIndex: number; // 1..64
  midiPort?: MidiPortLetter;
  midiChannel?: number; // 1..16
  midiProgram?: number; // 1..128
  isPercussion?: boolean;
  transposition?: InstrumentTransposition;
  clef?: { sign: "G" | "F" | "C" | "percussion"; line: number };
  notes: ScoreNoteEvent[];
}

export interface ScoreDocumentDefinition {
  title: string;
  divisions: number;
  numerator: number;
  denominator: number;
  fifths?: number;
  bpm?: number;
  parts: ScorePartDefinition[];
}

export const ORCHESTRAL_TRANSPOSITIONS: Record<string, InstrumentTransposition> = {
  piccolo: { diatonic: 0, chromatic: 0, octaveChange: 1 },
  clarinet_eb: { diatonic: 2, chromatic: 3 },
  clarinet_bb: { diatonic: -1, chromatic: -2 },
  bass_clarinet_bb: { diatonic: -1, chromatic: -2, octaveChange: -1 },
  soprano_sax_bb: { diatonic: -1, chromatic: -2 },
  alto_sax_eb: { diatonic: -5, chromatic: -9 },
  tenor_sax_bb: { diatonic: -1, chromatic: -2, octaveChange: -1 },
  baritone_sax_eb: { diatonic: -5, chromatic: -9, octaveChange: -1 },
  french_horn_f: { diatonic: -4, chromatic: -7 },
  trumpet_bb: { diatonic: -1, chromatic: -2 },
  contrabass: { diatonic: 0, chromatic: 0, octaveChange: -1 },
};

const PORT_NUMBER_MAP: Record<MidiPortLetter, number> = { A: 1, B: 2, C: 3, D: 4 };

export function resolveMidiPortAndChannel(
  part: Pick<ScorePartDefinition, "family" | "globalIndex" | "midiPort" | "midiChannel" | "isPercussion">
): { portLetter: MidiPortLetter; portNumber: number; midiChannel: number } {
  // Assign Port by Orchestral Family (Pillar 2) unless explicitly provided
  let portLetter: MidiPortLetter = part.midiPort ?? "A";
  if (!part.midiPort) {
    if (part.family === "woodwinds") portLetter = "A";
    else if (part.family === "brass") portLetter = "B";
    else if (part.family === "strings") portLetter = "C";
    else portLetter = "D"; // percussion, choir, vocals, fx
  }
  const portNumber = PORT_NUMBER_MAP[portLetter];

if (part.isPercussion || part.family === "percussion" || part.family === "fx") {
    return { portLetter, portNumber, midiChannel: 10 };
  }

if (part.midiChannel !== undefined) {
    if (!Number.isInteger(part.midiChannel) || part.midiChannel < 1 || part.midiChannel > 16) {
      throw new Error(`Canal MIDI inválido (${part.midiChannel}): debe estar entre 1 y 16 dentro de cada puerto.`);
    }
    const safeCh = part.midiChannel === 10 ? 11 : part.midiChannel;
    return { portLetter, portNumber, midiChannel: safeCh };
  }

// Map globalIndex (1..64) into the 15 melodic channels (1..9, 11..16) of the target port
  const melodicChannels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16];
  const slot = Math.max(0, (part.globalIndex - 1)) % melodicChannels.length;
  return { portLetter, portNumber, midiChannel: melodicChannels[slot] };
}

export function writeMusicXMLFromScoreDefinition(doc: ScoreDocumentDefinition): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    "  <work>",
    `    <work-title>${escapeXml(doc.title)}</work-title>`,
    "  </work>",
    "  <part-list>",
  ];

for (const part of doc.parts) {
    const { portLetter, portNumber, midiChannel } = resolveMidiPortAndChannel(part);
    const instId = `${part.id}-I1`;
    const program = part.midiProgram ?? (part.isPercussion ? 1 : 1);

lines.push(`    <score-part id="${escapeXml(part.id)}">`);
    lines.push(`      <part-name>${escapeXml(part.name)}</part-name>`);
    if (part.abbreviation) {
      lines.push(`      <part-abbreviation>${escapeXml(part.abbreviation)}</part-abbreviation>`);
    }
    lines.push(`      <score-instrument id="${escapeXml(instId)}">`);
    lines.push(`        <instrument-name>${escapeXml(part.name)}</instrument-name>`);
    lines.push("      </score-instrument>");
    lines.push(`      <midi-device id="${escapeXml(instId)}" port="${portNumber}">Port ${portLetter}</midi-device>`);
    lines.push(`      <midi-instrument id="${escapeXml(instId)}">`);
    lines.push(`        <midi-channel>${midiChannel}</midi-channel>`);
    lines.push(`        <midi-program>${Math.min(128, Math.max(1, program))}</midi-program>`);
    lines.push("      </midi-instrument>");
    lines.push("    </score-part>");
  }

lines.push("  </part-list>");

for (const part of doc.parts) {
    lines.push(`  <part id="${escapeXml(part.id)}">`);
    lines.push('    <measure number="1">');
    lines.push("      <attributes>");
    lines.push(`        <divisions>${doc.divisions}</divisions>`);
    lines.push("        <key>");
    lines.push(`          <fifths>${doc.fifths ?? 0}</fifths>`);
    lines.push("        </key>");
    lines.push("        <time>");
    lines.push(`          <beats>${doc.numerator}</beats>`);
    lines.push(`          <beat-type>${doc.denominator}</beat-type>`);
    lines.push("        </time>");
    const clef = part.clef ?? (part.isPercussion ? { sign: "percussion", line: 2 } : { sign: "G", line: 2 });
    lines.push("        <clef>");
    lines.push(`          <sign>${clef.sign}</sign>`);
    lines.push(`          <line>${clef.line}</line>`);
    lines.push("        </clef>");
    if (part.transposition) {
      lines.push("        <transpose>");
      lines.push(`          <diatonic>${part.transposition.diatonic}</diatonic>`);
      lines.push(`          <chromatic>${part.transposition.chromatic}</chromatic>`);
      if (part.transposition.octaveChange !== undefined && part.transposition.octaveChange !== 0) {
        lines.push(`          <octave-change>${part.transposition.octaveChange}</octave-change>`);
      }
      lines.push("        </transpose>");
    }
    lines.push("      </attributes>");

for (const note of part.notes) {
      lines.push("      <note>");
      const isUnpitched = Boolean(note.unpitched || part.isPercussion || part.family === "percussion" || part.family === "fx");
      if (isUnpitched) {
        lines.push("        <unpitched>");
        lines.push(`          <display-step>${note.displayStep ?? note.step ?? "E"}</display-step>`);
        lines.push(`          <display-octave>${note.displayOctave ?? note.octave ?? 4}</display-octave>`);
        lines.push("        </unpitched>");
      } else {
        lines.push("        <pitch>");
        lines.push(`          <step>${note.step ?? "C"}</step>`);
        if (note.alter !== undefined && note.alter !== 0) {
          lines.push(`          <alter>${note.alter}</alter>`);
        }
        lines.push(`          <octave>${note.octave ?? 4}</octave>`);
        lines.push("        </pitch>");
      }

lines.push(`        <duration>${Math.max(1, Math.round(note.durationDivisions))}</duration>`);
      lines.push(`        <voice>${note.voice ?? 1}</voice>`);
      lines.push(`        <type>${note.type}</type>`);

// XSD Order: <notehead> MUST appear BEFORE <staff>
      if (note.notehead) {
        lines.push(`        <notehead>${note.notehead}</notehead>`);
      }
      if (note.staff !== undefined) {
        lines.push(`        <staff>${note.staff}</staff>`);
      }

// XSD Order: <notations> MUST appear BEFORE <lyric>
      if (note.articulation) {
        lines.push("        <notations>");
        lines.push("          <articulations>");
        lines.push(`            <${note.articulation}/>`);
        lines.push("          </articulations>");
        lines.push("        </notations>");
      }

// XSD Order: <lyric> is a direct child of <note> and comes AFTER <notations>
      if (note.lyricText) {
        lines.push('        <lyric number="1">');
        lines.push(`          <syllabic>${note.syllabic ?? "single"}</syllabic>`);
        lines.push(`          <text>${escapeXml(note.lyricText)}</text>`);
        lines.push("        </lyric>");
      }

lines.push("      </note>");
    }

lines.push("    </measure>");
    lines.push("  </part>");
  }

lines.push("</score-partwise>");
  return lines.join("\n");
}

const CANONICAL_NOTE_CHILD_RANK: Record<string, number> = {
  grace: 1,
  cue: 2,
  chord: 3,
  pitch: 4,
  unpitched: 4,
  rest: 4,
  duration: 5,
  tie: 6,
  instrument: 7,
  footnote: 8,
  level: 9,
  voice: 10,
  type: 11,
  dot: 12,
  accidental: 13,
  "time-modification": 14,
  stem: 15,
  notehead: 16,
  "notehead-text": 17,
  staff: 18,
  beam: 19,
  notations: 20,
  lyric: 21,
  play: 22,
};

export function validateMusicXMLContract(xmlContent: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. Validate MIDI channels are strictly 1..16 and ports are 1..4
  const channelMatches = [...xmlContent.matchAll(/<midi-channel>(\s*\d+\s*)<\/midi-channel>/g)];
  for (const m of channelMatches) {
    const ch = Number(m[1].trim());
    if (!Number.isInteger(ch) || ch < 1 || ch > 16) {
      errors.push(`midi-channel fuera de rango estándar (1..16): ${ch}`);
    }
  }

const portMatches = [...xmlContent.matchAll(/<midi-device[^>]*port="([^"]+)"/g)];
  for (const m of portMatches) {
    const port = Number(m[1].trim());
    if (!Number.isInteger(port) || port < 1 || port > 4) {
      errors.push(`midi-device port fuera de rango (1..4): ${m[1]}`);
    }
  }

// 2. Validate <note> child element ordering and <unpitched> inner tags
  const noteBlocks = [...xmlContent.matchAll(/<note>([\s\S]*?)<\/note>/g)];
  noteBlocks.forEach((nb, idx) => {
    const body = nb[1];
    if (body.includes("<unpitched>") && body.includes("<pitch>")) {
      errors.push(`Nota #${idx + 1} contiene simultáneamente <pitch> y <unpitched>.`);
    }
    const unpitchedBlock = body.match(/<unpitched>([\s\S]*?)<\/unpitched>/);
    if (unpitchedBlock && (unpitchedBlock[1].includes("<notehead>") || unpitchedBlock[1].includes("<lyric"))) {
      errors.push(`Nota #${idx + 1} anida ilegalmente <notehead> o <lyric> dentro de <unpitched>.`);
    }

// Check top-level child order inside <note>
    const stripped = body
      .replace(/<pitch>[\s\S]*?<\/pitch>/g, "<pitch/>")
      .replace(/<unpitched>[\s\S]*?<\/unpitched>/g, "<unpitched/>")
      .replace(/<notations>[\s\S]*?<\/notations>/g, "<notations/>")
      .replace(/<lyric[^>]*>[\s\S]*?<\/lyric>/g, "<lyric/>");

const tags = [...stripped.matchAll(/<([a-zA-Z0-9-]+)(?:\s[^>]*)?\/?>/g)]
      .map((t) => t[1])
      .filter((t) => t in CANONICAL_NOTE_CHILD_RANK);

let prevRank = -1;
    let prevTag = "";
    for (const tag of tags) {
      const rank = CANONICAL_NOTE_CHILD_RANK[tag];
      if (rank < prevRank) {
        errors.push(`Orden XSD inválido en Nota #${idx + 1}: <${tag}> aparece después de <${prevTag}>.`);
      }
      prevRank = rank;
      prevTag = tag;
    }
  });

return { valid: errors.length === 0, errors };
}
