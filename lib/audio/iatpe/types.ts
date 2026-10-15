import { z } from "zod";

export const audioFormatInfoSchema = z.object({
  codec: z.string().min(1),
  container: z.string().min(1),
  isLossless: z.boolean(),
  durationSeconds: z.number().positive(),
  channels: z.number().int().min(1).max(8),
  sampleRate: z.number().int().min(8000).max(192000),
  bitrateKbps: z.number().positive().optional(),
});
export type AudioFormatInfo = z.infer<typeof audioFormatInfoSchema>;

export const spectralProfileSchema = z.object({
  rms: z.number().min(0),
  dynamicRangeDb: z.number().min(0),
  spectralCentroid: z.number().min(0),
  subtleEventsCount: z.number().int().min(0),
  primaryFrequencies: z.array(z.number().positive()).max(50),
  estimatedPitches: z.array(z.number().int().min(0).max(127)).max(50),
});
export type SpectralProfile = z.infer<typeof spectralProfileSchema>;

export const instrumentCandidateSchema = z.object({
  label: z.string().min(1),
  category: z.string().min(1),
  activation: z.number().min(0).max(1),
  audioSetId: z.string().optional(),
});
export type InstrumentCandidate = z.infer<typeof instrumentCandidateSchema>;

export const googleClassificationResultSchema = z.object({
  topCandidate: z.string().min(1),
  topScore: z.number().min(0).max(1),
  candidates: z.array(instrumentCandidateSchema).max(30),
  googleGeminiReview: z.string().optional(),
  classifierStatus: z
    .enum(["confident", "low_confidence", "no_candidates", "failed"])
    .optional(),
});
export type GoogleClassificationResult = z.infer<typeof googleClassificationResultSchema>;

export const channelItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  instrument: z.string().min(1),
  sourceAction: z.enum([
    "bypass_separation",
    "demucs_stem",
    "custom_filter",
    "sub_separation",
    "hierarchical_stem",
    "voice_leading_part",
    "sound_fx",
  ]),
  program: z.number().int().min(0).max(127).default(0),
  parentStem: z.string().optional(),
  family: z.string().optional(),
  level: z.number().int().min(1).max(3).default(1),
});
export type ChannelItem = z.infer<typeof channelItemSchema>;

export const channelPlanSchema = z.object({
  mode: z.enum(["solo", "ensemble"]),
  isSolo: z.boolean(),
  channelCount: z.number().int().min(1).max(64),
  primaryInstrument: z.string().min(1),
  confidence: z.number().min(0).max(1),
  channels: z.array(channelItemSchema).min(1).max(64),
  decisionReason: z.string().min(1),
  recommendedEngine: z.enum(["bs_roformer", "demucs", "ensemble"]).default("bs_roformer"),
  isHierarchical: z.boolean().default(false),
  hierarchicalLevels: z.number().int().min(1).max(3).default(1),
  subExtractionsPlanned: z
    .array(
      z.object({
        parentStem: z.string(),
        targetInstruments: z.array(z.string()),
      }),
    )
    .optional(),
});
export type ChannelPlan = z.infer<typeof channelPlanSchema>;

export const iatpeTimingsSchema = z.object({
  formatProbeMs: z.number().min(0),
  spectralAnalysisMs: z.number().min(0),
  classificationMs: z.number().min(0),
  dispatchMs: z.number().min(0),
  totalMs: z.number().min(0),
});
export type IatpeTimings = z.infer<typeof iatpeTimingsSchema>;

export const iatpeAnalysisResultSchema = z.object({
  format: audioFormatInfoSchema,
  spectral: spectralProfileSchema,
  googleClassification: googleClassificationResultSchema,
  channelPlan: channelPlanSchema,
  timingsMs: iatpeTimingsSchema,
});
export type IatpeAnalysisResult = z.infer<typeof iatpeAnalysisResultSchema>;

export const MidiPortSchema = z.enum(["A", "B", "C", "D"]);
export type MidiPort = z.infer<typeof MidiPortSchema>;

export const ActivityRegionSchema = z.object({
  sourceId: z.string(),
  instrument: z.string(),
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  windowLabel: z.enum(["intro", "early_body", "mid_core", "climax", "outro"]),
  method: z.enum(["spectral_band", "yamnet_temporal", "clap_zero_shot", "rms_hysteresis"]),
  confidence: z.number().min(0).max(1),
  uncertainPresence: z.boolean().default(false),
  evidence: z.object({
    rmsDb: z.number(),
    spectralCentroidHz: z.number(),
    harmonicRatio: z.number(),
    transientDensity: z.number(),
  }),
});
export type ActivityRegion = z.infer<typeof ActivityRegionSchema>;

export const AudioAssetMetadataSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  file: z.string(),
  engine: z.enum(["demucs", "bs_roformer", "mel_band_roformer", "iatpe_ensemble", "bypass_direct"]),
  checkpoint: z.string(),
  sampleRate: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  sha256: z.string().min(32),
  gain: z.number().positive(),
  rms: z.number().min(0),
  confidence: z.number().min(0).max(1),
  transcriptionEligible: z.boolean(),
  level: z.number().int().min(1).max(3),
  parentStem: z.string().optional(),
  parentPreservedFile: z.string().optional(),
  parentSha256: z.string().optional(),
  sourceEngineSubdir: z.string().optional(),
  reconstructionMaxAbsError: z.number().min(0).optional(),
  reconstructionVerified: z.boolean().optional(),
});
export type AudioAssetMetadata = z.infer<typeof AudioAssetMetadataSchema>;

export const StageTelemetrySchema = z.object({
  loadMs: z.number().min(0),
  preanalysisMs: z.number().min(0).default(0),
  inferenceMs: z.number().min(0),
  subseparationMs: z.number().min(0).default(0),
  amtMs: z.number().min(0).default(0),
  ioMs: z.number().min(0),
  totalWallMs: z.number().min(0),
  timeToFirstAudibleStemMs: z.number().min(0),
  peakMemoryMb: z.number().min(0),
  effectiveInferredSeconds: z.number().min(0),
  coverageRatio: z.number().min(0).max(1),
  cacheHit: z.boolean().default(false),
  coalescedInFlight: z.boolean().default(false),
  notesPerChannel: z.record(z.string(), z.number().int().min(0)).default({}),
});
export type StageTelemetry = z.infer<typeof StageTelemetrySchema>;

export const DistributedPreanalysisResultSchema = z.object({
  totalDurationSeconds: z.number().positive(),
  sampledWindowsCount: z.number().int().min(1),
  isConfirmedSoloInstrument: z.boolean(),
  soloBypassReason: z.string(),
  detectedInstruments: z.array(z.string()),
  uncertainInstruments: z.array(z.string()),
  activityRegions: z.array(ActivityRegionSchema),
  channelCount: z.number().int().min(1).max(64),
});
export type DistributedPreanalysisResult = z.infer<typeof DistributedPreanalysisResultSchema>;
