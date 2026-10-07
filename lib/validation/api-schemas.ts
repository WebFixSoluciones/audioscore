import { z } from "zod";
import { documentSchema } from "@/lib/music/types";
import { exportFormats } from "@/lib/billing/plans";
export const keySchema = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
export const newProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    idempotencyKey: keySchema,
  })
  .strict();
export const uploadSchema = z
  .object({
    name: z.string().min(1).max(200),
    mime: z.string().max(100),
    size: z.number().int().positive(),
  })
  .strict();
export const analyzeSchema = z
  .object({
    idempotencyKey: keySchema,
    region: z
      .tuple([z.number().nonnegative(), z.number().positive()])
      .optional(),
  })
  .strict();
export const exportSchema = z
  .object({
    idempotencyKey: keySchema,
    format: z.enum(exportFormats),
    sourceId: z.string().min(1).max(100).optional(),
  })
  .strict();
export const correctionSchema = z
  .object({
    document: documentSchema,
    expectedRevision: z.number().int().nonnegative(),
    operation: z.string().max(100),
  })
  .strict();
