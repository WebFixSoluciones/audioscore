export const TRANSCRIPTION_SAMPLE_RATE = 22050;
export type DetectedNote = {
  startSeconds: number;
  durationSeconds: number;
  midiNote: number;
  activation: number;
};
export type InstrumentPrediction = {
  label: string;
  labelEs: string;
  score: number;
  audiosetId?: string;
  referenceUrl?: string;
  kind?: "instrument" | "family" | "technique" | "voice";
};
export type TranscriptionResult = {
  notes: DetectedNote[];
  excludedNotes?: (DetectedNote & { reason: string })[];
  durationSeconds: number;
  tempo: { bpm: number; confidence: number };
  instruments: InstrumentPrediction[];
  warnings: string[];
};
export type TranscriptionProgress = {
  stage: string;
  progress: number;
};
export type TranscriptionWorkerMessage =
  | { type: "progress"; value: TranscriptionProgress }
  | { type: "complete"; result: TranscriptionResult }
  | { type: "error"; message: string };
