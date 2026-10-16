import { validateDocument } from "@/lib/music/notation-validation";
import { secondsToTicks } from "@/lib/music/tempo-map";
import type { AudioSource, MusicDocument } from "@/lib/music/types";
import type { SeparatedStem } from "@/lib/audio/separation";

const programs: Record<string, number> = {
  piano: 0,
  guitar: 24,
  bass: 32,
  vocals: 53,
  other: 0,
  unknown: 0,
  drums: 0,
  percussion: 116,
  sound_fx: 127,
};

/**
 * Voice Leading Disentanglement:
 * Separa eventos de acordes o notas simultáneas polifónicas (ej. coro SATB o metales en bloque)
 * en líneas melódicas individuales ordenadas por altura (Soprano, Contralto, Tenor, Bajo).
 */
export function disentanglePolyphonicVoices<
  T extends { midiNote?: number; pitches?: number[]; startSeconds: number },
>(events: T[], maxVoices: number = 4): T[][] {
  const voices: T[][] = Array.from({ length: maxVoices }, () => []);
  const timeBuckets = new Map<number, T[]>();
  for (const ev of events) {
    const key = Math.round(ev.startSeconds * 100) / 100;
    const list = timeBuckets.get(key) || [];
    list.push(ev);
    timeBuckets.set(key, list);
  }

  for (const [, cluster] of timeBuckets.entries()) {
    const sorted = [...cluster].sort((a, b) => {
      const pitchA = a.midiNote ?? (a.pitches ? Math.max(...a.pitches) : 60);
      const pitchB = b.midiNote ?? (b.pitches ? Math.max(...b.pitches) : 60);
      return pitchB - pitchA;
    });

    sorted.forEach((note, idx) => {
      const voiceIdx = Math.min(idx, maxVoices - 1);
      voices[voiceIdx].push(note);
    });
  }

  return voices.filter((v) => v.length > 0);
}

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
    const isPercussive = stem.kind === "drums" || stem.kind === "percussion";
    const isSoundFx = stem.kind === "sound_fx";
    const portLetter = (index < 16 ? "A" : index < 32 ? "B" : index < 48 ? "C" : "D") as "A" | "B" | "C" | "D";
    const source: AudioSource = {
      id: stem.id,
      name: stem.label,
      nameEs: stem.label,
      category:
        isPercussive
          ? "percussive"
          : isSoundFx
            ? "noise"
            : stem.kind === "other" || stem.kind === "unknown"
              ? "mixed"
              : "tonal",
      family: stem.family || stem.label,
      acousticOrElectronic: "unknown",
      analogOrDigital: "unknown",
      polyphony: "unknown",
      confidence: stem.confidence,
      evidence: "estimated",
      program: stem.program !== undefined ? stem.program : (programs[stem.kind] ?? 0),
      channel: isPercussive ? 10 : (index % 16) + 1,
      port: portLetter,
      notationLayout: stem.kind === "piano" ? "piano" : "single",
      storagePath: stem.storagePath,
      warnings: [
        "Categoría estimada por separación; revisa contaminación entre canales.",
      ],
    };
    // Pitch detection is not a drum classifier. Keep the playable audio without inventing drum notes.
    if (isPercussive) {
      source.warnings.push(
        "Stem de batería/percusión disponible. La transcripción de percusión requiere un motor específico.",
      );
    } else if (isSoundFx) {
      source.warnings.push(
        "Stem de Efectos de Sonido / Foley (FX). Notación percusiva de efectos sin altura melódica fija.",
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
      const durationDiff = Math.abs(doc.durationSeconds - global.durationSeconds);
      if (durationDiff > 0.2 || doc.provenance !== "transcription")
        throw new Error(
          `La transcripción del stem no conserva la duración del original (diferencia de ${durationDiff.toFixed(2)}s)`,
        );
      doc.durationSeconds = global.durationSeconds;
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
          notehead: isSoundFx ? "cross" : event.notehead,
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

export interface PolyphonicNoteInput {
  id: string;
  startSeconds: number;
  durationSeconds: number;
  midiPitch: number;
  velocity: number;
  confidence: number;
  lyricText?: string;
}

export interface TrackedVoiceNote extends PolyphonicNoteInput {
  voiceIndex: number; // 1 = top/lead voice, 2 = second voice, etc.
  isUnison: boolean;
  voiceCrossingDetected: boolean;
  needsHumanReview: boolean;
}

export interface DisentangledVoiceStream {
  voiceIndex: number;
  roleLabel: string;
  tessituraRangeMidi: [number, number];
  notes: TrackedVoiceNote[];
  unisonCount: number;
  voiceCrossingCount: number;
  needsHumanReview: boolean;
}

const SATB_LABELS = ["Soprano (Voz 1)", "Alto (Voz 2)", "Tenor (Voz 3)", "Bajo (Voz 4)"];

export function disentanglePolyphonicVoicesWithTracking(
  events: PolyphonicNoteInput[],
  maxVoices: number = 4,
  roleLabels: string[] = SATB_LABELS,
  onsetBucketToleranceSec: number = 0.045
): DisentangledVoiceStream[] {
  if (events.length === 0) return [];

const sorted = [...events].sort(
    (a, b) => a.startSeconds - b.startSeconds || b.midiPitch - a.midiPitch
  );

// Group simultaneous notes into temporal buckets
  const buckets: PolyphonicNoteInput[][] = [];
  for (const ev of sorted) {
    const lastBucket = buckets[buckets.length - 1];
    if (
      !lastBucket ||
      Math.abs(ev.startSeconds - lastBucket[0].startSeconds) > onsetBucketToleranceSec
    ) {
      buckets.push([ev]);
    } else {
      lastBucket.push(ev);
    }
  }

const numVoices = Math.max(1, Math.min(8, maxVoices));
  const streams: TrackedVoiceNote[][] = Array.from({ length: numVoices }, () => []);
  // Last known MIDI pitch for each voice stream to maintain melodic continuity
  const lastPitchPerVoice: Array<number | null> = Array.from({ length: numVoices }, () => null);

for (const bucket of buckets) {
    // Sort notes in bucket high-to-low initially
    const chord = [...bucket].sort((a, b) => b.midiPitch - a.midiPitch).slice(0, numVoices);

// Check for unisons (two simultaneous notes with identical MIDI pitch or <= 1 semitone in section)
    const pitchCounts = new Map<number, number>();
    for (const n of chord) {
      pitchCounts.set(n.midiPitch, (pitchCounts.get(n.midiPitch) ?? 0) + 1);
    }

if (chord.length === 1 && lastPitchPerVoice.some((p) => p !== null)) {
      // Assign single note to the voice whose previous pitch is closest
      const note = chord[0];
      let bestVoice = 0;
      let bestDist = Infinity;
      for (let v = 0; v < numVoices; v++) {
        const prev = lastPitchPerVoice[v];
        if (prev !== null) {
          const dist = Math.abs(note.midiPitch - prev);
          if (dist < bestDist) {
            bestDist = dist;
            bestVoice = v;
          }
        }
      }
      lastPitchPerVoice[bestVoice] = note.midiPitch;
      streams[bestVoice].push({
        ...note,
        voiceIndex: bestVoice + 1,
        isUnison: false,
        voiceCrossingDetected: false,
        needsHumanReview: bestDist > 14,
      });
      continue;
    }

// Continuity-aware assignment for polyphonic chords
    const usedVoices = new Set<number>();
    const assignedForBucket: Array<{ voiceIdx: number; note: PolyphonicNoteInput }> = [];

for (let i = 0; i < chord.length; i++) {
      const note = chord[i];
      let chosenVoice = Math.min(i, numVoices - 1);
      while (usedVoices.has(chosenVoice) && chosenVoice + 1 < numVoices) {
        chosenVoice += 1;
      }

// Check if an adjacent free voice has a much closer melodic continuation
      let minCost = Infinity;
      for (let v = 0; v < numVoices; v++) {
        if (usedVoices.has(v)) continue;
        const prev = lastPitchPerVoice[v];
        const pitchDiff = prev !== null ? Math.abs(note.midiPitch - prev) : Math.abs(v - i) * 4;
        const orderPenalty = Math.abs(v - i) * 3.5;
        const cost = pitchDiff + orderPenalty;
        if (cost < minCost) {
          minCost = cost;
          chosenVoice = v;
        }
      }

usedVoices.add(chosenVoice);
      assignedForBucket.push({ voiceIdx: chosenVoice, note });
    }

// Detect voice crossings: when a lower voiceIdx (higher nominal part) has a LOWER pitch than a higher voiceIdx
    let crossingInChord = false;
    for (let a = 0; a < assignedForBucket.length; a++) {
      for (let b = a + 1; b < assignedForBucket.length; b++) {
        const first = assignedForBucket[a];
        const second = assignedForBucket[b];
        if (
          (first.voiceIdx < second.voiceIdx && first.note.midiPitch < second.note.midiPitch) ||
          (first.voiceIdx > second.voiceIdx && first.note.midiPitch > second.note.midiPitch)
        ) {
          crossingInChord = true;
        }
      }
    }

for (const { voiceIdx, note } of assignedForBucket) {
      const isUnison = (pitchCounts.get(note.midiPitch) ?? 0) > 1;
      lastPitchPerVoice[voiceIdx] = note.midiPitch;
      streams[voiceIdx].push({
        ...note,
        voiceIndex: voiceIdx + 1,
        isUnison,
        voiceCrossingDetected: crossingInChord,
        needsHumanReview: crossingInChord || isUnison || note.confidence < 0.55,
      });
    }
  }

return streams
    .map((notes, idx) => {
      const pitches = notes.map((n) => n.midiPitch);
      const minPitch = pitches.length > 0 ? Math.min(...pitches) : 60;
      const maxPitch = pitches.length > 0 ? Math.max(...pitches) : 72;
      const unisonCount = notes.filter((n) => n.isUnison).length;
      const voiceCrossingCount = notes.filter((n) => n.voiceCrossingDetected).length;
      return {
        voiceIndex: idx + 1,
        roleLabel: roleLabels[idx] ?? `Atril / Voz ${idx + 1}`,
        tessituraRangeMidi: [minPitch, maxPitch] as [number, number],
        notes,
        unisonCount,
        voiceCrossingCount,
        needsHumanReview: unisonCount > 0 || voiceCrossingCount > 0 || notes.some((n) => n.needsHumanReview),
      };
    })
    .filter((s) => s.notes.length > 0);
}
