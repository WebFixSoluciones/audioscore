import { z } from "zod";

export const separationEngineSchema = z.enum([
  "bs_roformer",
  "demucs",
  "ensemble",
]);
export type SeparationEngine = z.infer<typeof separationEngineSchema>;

export const localAnalysisOptionsSchema = z
  .object({
    quality: z.enum(["balanced", "careful"]).default("balanced"),
    reduceNoise: z.boolean().default(false),
    tempo: z.enum(["steady", "adaptive"]).default("steady"),
    detectBars: z.boolean().default(true),
    separationEngine: separationEngineSchema.optional(),
  })
  .strict();
export type LocalAnalysisOptions = z.infer<typeof localAnalysisOptionsSchema>;
export const defaultAnalysisOptions: LocalAnalysisOptions = {
  quality: "balanced",
  reduceNoise: false,
  tempo: "steady",
  detectBars: true,
};
