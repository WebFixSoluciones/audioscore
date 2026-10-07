import type { DetectedNote, InstrumentPrediction } from "./types";

export type ExcludedNote = DetectedNote & { reason: string };

/** A register boundary, not a claim about which hand played a note. */
export function estimatePianoSplit(notes: DetectedNote[]) {
  const first = Math.min(...notes.map((n) => n.startSeconds));
  const opening = notes.filter(
    (n) =>
      n.activation >= 0.5 &&
      n.durationSeconds >= 0.2 &&
      n.startSeconds <= first + 20,
  );
  if (opening.length < 8) return 60;
  let low = Math.min(...opening.map((n) => n.midiNote)),
    high = Math.max(...opening.map((n) => n.midiNote));
  for (let iteration = 0; iteration < 12; iteration++) {
    const boundary = (low + high) / 2;
    const groups = [
      opening.filter((n) => n.midiNote < boundary),
      opening.filter((n) => n.midiNote >= boundary),
    ];
    if (groups.some((g) => !g.length)) return 60;
    [low, high] = groups.map(
      (g) =>
        g.reduce((s, n) => s + n.midiNote * n.activation, 0) /
        g.reduce((s, n) => s + n.activation, 0),
    );
  }
  return high - low >= 10 ? Math.round((low + high) / 2) : 60;
}

export function isPianoRecording(instruments: InstrumentPrediction[]) {
  const piano = Math.max(
    0,
    ...instruments
      .filter((i) => ["Piano", "Electric piano"].includes(i.label))
      .map((i) => i.score),
  );
  const other = Math.max(
    0,
    ...instruments
      .filter((i) => !["Piano", "Electric piano"].includes(i.label))
      .map((i) => i.score),
  );
  return piano >= 0.35 && piano > other + 0.1;
}

/** Conservative piano-only screening. Rejected candidates remain recoverable. */
export function refinePianoNotes(input: DetectedNote[]) {
  const sorted = [...input].sort((a, b) => a.startSeconds - b.startSeconds);
  const notes: DetectedNote[] = [],
    excludedNotes: ExcludedNote[] = [];
  for (const note of sorted) {
    const concurrent = sorted.filter(
      (other) =>
        other !== note &&
        other.activation >= 0.5 &&
        other.startSeconds <= note.startSeconds + 0.06 &&
        other.startSeconds + other.durationSeconds >=
          note.startSeconds + Math.min(0.1, note.durationSeconds * 0.7),
    );
    const harmonic = concurrent.some(
      (other) =>
        [12, 19, 24, 28].includes(note.midiNote - other.midiNote) &&
        note.activation < 0.5 &&
        note.activation < other.activation * 0.65 &&
        note.durationSeconds <= other.durationSeconds,
    );
    const transient =
      note.activation < 0.43 &&
      note.durationSeconds < 0.23 &&
      concurrent.length > 0;
    if (harmonic || transient)
      excludedNotes.push({
        ...note,
        reason: harmonic
          ? "Posible armónico débil de otra nota"
          : "Detección breve y débil junto a notas más claras",
      });
    else notes.push({ ...note });
  }
  return { notes, excludedNotes };
}

/** Choose between octave-related pulses only when clear upper-register attacks support it. */
export function resolvePianoPulse(
  tempo: { bpm: number; confidence: number },
  notes: DetectedNote[],
) {
  if (!tempo.confidence || notes.length < 16) return tempo;
  const first = Math.min(...notes.map((n) => n.startSeconds));
  const opening = notes.filter(
    (n) => n.startSeconds <= first + 0.12 && n.activation >= 0.55,
  );
  const upperRegister = Math.max(
    60,
    Math.max(0, ...opening.map((n) => n.midiNote)) - 2,
  );
  const attacks = notes
    .filter(
      (n) =>
        n.midiNote >= upperRegister &&
        n.activation >= 0.55 &&
        n.durationSeconds >= 0.25 &&
        n.startSeconds <= first + 40,
    )
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const times: number[] = [];
  for (const n of attacks)
    if (!times.length || n.startSeconds - times[times.length - 1] > 0.12)
      times.push(n.startSeconds);
  const intervals = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((x) => x >= 0.25 && x <= 2.5)
    .slice(0, 16);
  if (intervals.length < 8) return tempo;
  const support = (bpm: number) =>
    intervals.filter((x) => Math.abs(x - 60 / bpm) <= (60 / bpm) * 0.16).length;
  const base = support(tempo.bpm),
    half = tempo.bpm / 2;
  // A majority of quarter-like melody attacks is needed; never halve solely by BPM.
  if (
    half >= 40 &&
    support(half) >= 8 &&
    support(half) >= intervals.length * 0.5 &&
    support(half) >= base * 1.6
  ) {
    // Fit the first stable phrase to a half-beat grid, avoiding accumulated drift.
    const beatTimes = [{ beat: 0, time: times[0] }];
    for (let i = 1; i < times.length && beatTimes.length < 20; i++) {
      const gap = times[i] - times[i - 1];
      if (gap > 2.5) break;
      const beats = Math.round((gap / (60 / half)) * 2) / 2;
      if (beats <= 0 || Math.abs(gap - (beats * 60) / half) > 0.12) break;
      beatTimes.push({
        beat: beatTimes[beatTimes.length - 1].beat + beats,
        time: times[i],
      });
    }
    let bpm = half;
    if (beatTimes.length >= 9) {
      const meanBeat =
        beatTimes.reduce((s, x) => s + x.beat, 0) / beatTimes.length;
      const meanTime =
        beatTimes.reduce((s, x) => s + x.time, 0) / beatTimes.length;
      const slope =
        beatTimes.reduce(
          (s, x) => s + (x.beat - meanBeat) * (x.time - meanTime),
          0,
        ) / beatTimes.reduce((s, x) => s + (x.beat - meanBeat) ** 2, 0);
      const fitted = 60 / slope;
      if (Number.isFinite(fitted) && Math.abs(fitted - half) <= half * 0.05)
        bpm = Math.round(fitted * 10) / 10;
    }
    return {
      bpm,
      confidence: Math.min(
        0.8,
        Math.max(tempo.confidence, (support(half) / intervals.length) * 0.6),
      ),
    };
  }
  return tempo;
}
