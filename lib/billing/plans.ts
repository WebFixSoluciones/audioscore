import { z } from "zod";
export const exportFormats = [
  "midi",
  "musicxml",
  "mei",
  "pdf",
  "wav",
  "mp3",
  "json",
  "zip",
] as const;
export type ExportFormat = (typeof exportFormats)[number];
export const featureNames = [
  "advancedAnalysis",
  "manualCorrection",
  "priorityProcessing",
  "batchProcessing",
  "sourceSeparation",
  "fullScoreExport",
] as const;
export type Feature = (typeof featureNames)[number];
export const planSchema = z.object({
  id: z.enum(["free", "starter", "pro", "studio", "enterprise"]),
  name: z.string().trim().min(1).max(80),
  priceMonthly: z.number().nonnegative().max(1000000),
  currency: z.literal("USD"),
  monthlyAudioMinutes: z.number().positive(),
  maxFileDurationSeconds: z.number().positive(),
  maxFileBytes: z
    .number()
    .int()
    .positive()
    .max(250 * 1024 * 1024),
  maxProjects: z.number().int().positive(),
  maxSources: z.number().int().min(1).max(64),
  maxConcurrentJobs: z.number().int().positive(),
  retentionDays: z.number().int().min(1).max(7),
  allowedExports: z
    .array(z.enum(exportFormats))
    .min(1)
    .max(exportFormats.length)
    .refine(
      (values) => new Set(values).size === values.length,
      "Las exportaciones no pueden repetirse",
    ),
  features: z.object({
    advancedAnalysis: z.boolean(),
    manualCorrection: z.boolean(),
    priorityProcessing: z.boolean(),
    batchProcessing: z.boolean(),
    sourceSeparation: z.boolean(),
    fullScoreExport: z.boolean(),
  }),
});
export type Plan = z.infer<typeof planSchema>;
function plan(
  id: Plan["id"],
  name: string,
  price: number,
  minutes: number,
  duration: number,
  projects: number,
  sources: number,
  concurrency: number,
  retention: number,
  exports: ExportFormat[],
  level: number,
): Plan {
  return {
    id,
    name,
    priceMonthly: price,
    currency: "USD",
    monthlyAudioMinutes: minutes,
    maxFileDurationSeconds: duration,
    maxFileBytes: 250 * 1024 * 1024,
    maxProjects: projects,
    maxSources: sources,
    maxConcurrentJobs: concurrency,
    retentionDays: retention,
    allowedExports: exports,
    features: {
      advancedAnalysis: level >= 2,
      manualCorrection: level >= 1,
      priorityProcessing: level >= 2,
      batchProcessing: level >= 3,
      sourceSeparation: level >= 1,
      fullScoreExport: level >= 2,
    },
  };
}
export const PLANS: Plan[] = [
  plan("free", "Free", 0, 10, 120, 3, 2, 1, 1, ["midi", "json"], 0),
  plan(
    "starter",
    "Starter",
    12,
    60,
    300,
    15,
    4,
    1,
    3,
    ["midi", "musicxml", "json", "wav", "mp3"],
    1,
  ),
  plan("pro", "Pro", 29, 300, 900, 50, 12, 2, 7, [...exportFormats], 2),
  plan(
    "studio",
    "Studio",
    79,
    1000,
    1800,
    200,
    32,
    4,
    7,
    [...exportFormats],
    3,
  ),
  plan(
    "enterprise",
    "Enterprise",
    199,
    5000,
    7200,
    1000,
    64,
    8,
    7,
    [...exportFormats],
    3,
  ),
];
export function getDefaultPlan(id: string): Plan {
  const p = PLANS.find((p) => p.id === id);
  if (!p) throw new Error("Plan desconocido");
  return p;
}
export function checkQuota(
  p: Plan,
  duration: number,
  used: number,
  reserved: number,
  active: number,
) {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > p.maxFileDurationSeconds
  )
    throw new Error("Duración fuera del límite del plan");
  if (active >= p.maxConcurrentJobs)
    throw new Error("Ya alcanzaste el límite de trabajos simultáneos");
  if (used + reserved + duration / 60 > p.monthlyAudioMinutes + 1e-8)
    throw new Error("No quedan minutos suficientes este mes");
}
