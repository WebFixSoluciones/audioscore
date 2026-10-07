import { z } from "zod";

export const PPQ = 128;
export const confidenceSchema = z.number().min(0).max(1);
export const tempoSchema = z.object({
  startSeconds: z.number().nonnegative(),
  bpm: z.number().min(20).max(400),
  confidence: confidenceSchema,
});
export const sourceSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  name: z.string().min(1).max(120),
  nameEs: z.string().max(120),
  category: z.enum(["tonal", "percussive", "noise", "mixed"]),
  family: z.string().max(100),
  acousticOrElectronic: z.enum([
    "acoustic",
    "electric",
    "electronic",
    "processed",
    "unknown",
  ]),
  analogOrDigital: z.enum([
    "analog",
    "digital",
    "probably_analog",
    "probably_digital",
    "unknown",
  ]),
  polyphony: z.enum(["monophonic", "polyphonic", "unknown"]),
  confidence: confidenceSchema,
  evidence: z.enum(["detected", "inferred", "estimated", "unknown", "human"]),
  program: z.number().int().min(0).max(127).default(0),
  notationLayout: z.enum(["single", "piano"]).optional(),
  notationSplitPitch: z.number().int().min(0).max(127).optional(),
  channel: z.number().int().min(1).max(16).default(1),
  warnings: z.array(z.string().max(500)).max(100),
  storagePath: z.string().optional(),
});
export const eventSchema = z
  .object({
    id: z.string().min(1).max(100),
    sourceId: z.string().min(1).max(100),
    type: z.enum(["note", "chord", "drum", "rest", "automation"]),
    startSeconds: z.number().nonnegative(),
    durationSeconds: z.number().positive(),
    startTick: z.number().int().nonnegative(),
    durationTicks: z.number().int().positive(),
    midiNote: z.number().int().min(0).max(127).optional(),
    pitches: z
      .array(z.number().int().min(0).max(127))
      .min(1)
      .max(16)
      .optional(),
    velocity: z.number().int().min(1).max(127).default(90),
    articulation: z
      .enum(["normal", "staccato", "accent", "tenuto"])
      .default("normal"),
    pitchBend: z.number().int().min(-8192).max(8191).optional(),
    confidence: confidenceSchema,
    isHumanReviewed: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((e, ctx) => {
    if ((e.type === "note" || e.type === "drum") && e.midiNote === undefined)
      ctx.addIssue({ code: "custom", message: "La nota requiere pitch MIDI" });
    if (e.type === "chord" && !e.pitches)
      ctx.addIssue({ code: "custom", message: "El acorde requiere pitches" });
  });
export const documentSchema = z.object({
  title: z.string().min(1).max(120),
  durationSeconds: z.number().nonnegative().max(7200),
  tempoMap: z.array(tempoSchema).min(1).max(500),
  timeSignature: z.tuple([
    z.number().int().min(1).max(12),
    z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
  ]),
  key: z
    .enum([
      "C",
      "G",
      "D",
      "A",
      "E",
      "B",
      "F#",
      "F",
      "Bb",
      "Eb",
      "Ab",
      "Db",
      "Gb",
      "Am",
      "Em",
      "Bm",
      "Dm",
      "Gm",
      "Cm",
      "C#m",
      "Ebm",
      "Fm",
      "F#m",
      "G#m",
      "Bbm",
    ])
    .default("C"),
  sources: z.array(sourceSchema).max(64),
  events: z.array(eventSchema).max(10000),
  sections: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().max(100),
        startSeconds: z.number().nonnegative(),
        endSeconds: z.number().nonnegative(),
        confidence: confidenceSchema,
      }),
    )
    .max(100),
  warnings: z.array(z.string().max(1000)).max(200),
  confidence: confidenceSchema,
  provenance: z.enum(["manual", "midi_import", "transcription"]),
  analysis: z
    .object({
      engine: z.string().max(100),
      keyConfidence: confidenceSchema,
      scoreOriginSeconds: z.number().nonnegative().optional(),
      excludedNotes: z
        .array(
          z.object({
            startSeconds: z.number().nonnegative(),
            durationSeconds: z.number().positive(),
            midiNote: z.number().int().min(0).max(127),
            activation: confidenceSchema,
            reason: z.string().max(200),
          }),
        )
        .max(10000)
        .optional(),
      instrumentPredictions: z
        .array(
          z.object({
            label: z.string().max(100),
            labelEs: z.string().max(100),
            score: confidenceSchema,
            audiosetId: z
              .string()
              .regex(/^\/[mt]\/[\w]+$/)
              .optional(),
            referenceUrl: z
              .string()
              .regex(
                /^https:\/\/research\.google\.com\/audioset\/ontology\/[a-z0-9_]+\.html$/,
              )
              .optional(),
            kind: z
              .enum(["instrument", "family", "technique", "voice"])
              .optional(),
          }),
        )
        .max(20),
    })
    .optional(),
  revision: z.number().int().nonnegative(),
});
export type TempoChange = z.infer<typeof tempoSchema>;
export type AudioSource = z.infer<typeof sourceSchema>;
export type MusicalEvent = z.infer<typeof eventSchema>;
export type MusicDocument = z.infer<typeof documentSchema>;
export const emptyDocument = (): MusicDocument => ({
  title: "Proyecto sin título",
  durationSeconds: 0,
  tempoMap: [{ startSeconds: 0, bpm: 120, confidence: 1 }],
  timeSignature: [4, 4],
  key: "C",
  sources: [],
  events: [],
  sections: [],
  warnings: [],
  confidence: 0,
  provenance: "manual",
  revision: 0,
});
export const projectStates = [
  "draft",
  "uploaded",
  "queued",
  "validating",
  "normalizing",
  "global_analysis",
  "source_separation",
  "instrument_detection",
  "note_transcription",
  "midi_generation",
  "musicxml_generation",
  "pdf_generation",
  "quality_validation",
  "completed",
  "needs_review",
  "failed",
  "cancelled",
  "expired",
] as const;
export type ProjectState = (typeof projectStates)[number];
export type Project = {
  id: string;
  userId: string;
  title: string;
  status: ProjectState;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  durationSeconds?: number;
  storagePath?: string;
  document?: MusicDocument;
  activeJobId?: string;
  error?: string;
  revision: number;
  peaks?: number[];
};
