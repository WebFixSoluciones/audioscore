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
});
export type GoogleClassificationResult = z.infer<typeof googleClassificationResultSchema>;

export const channelItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  instrument: z.string().min(1),
  sourceAction: z.enum(["bypass_separation", "demucs_stem", "custom_filter"]),
  program: z.number().int().min(0).max(127).default(0),
});
export type ChannelItem = z.infer<typeof channelItemSchema>;

export const channelPlanSchema = z.object({
  mode: z.enum(["solo", "ensemble"]),
  isSolo: z.boolean(),
  channelCount: z.number().int().min(1).max(16),
  primaryInstrument: z.string().min(1),
  confidence: z.number().min(0).max(1),
  channels: z.array(channelItemSchema).min(1).max(16),
  decisionReason: z.string().min(1),
  recommendedEngine: z.enum(["bs_roformer", "demucs", "ensemble"]).default("bs_roformer"),
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
