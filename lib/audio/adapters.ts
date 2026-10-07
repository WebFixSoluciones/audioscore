import "server-only";
import { z } from "zod";
import { documentSchema, type MusicDocument } from "@/lib/music/types";
import { ApiError } from "@/lib/utils/errors";
import { assertStorageOwner, signedRead } from "@/lib/firebase/storage";
import { existsSync } from "node:fs";
import { join } from "node:path";
const separationSchema = z.object({
  sources: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
        storagePath: z.string(),
        confidence: z.number().min(0).max(1),
        label: z.string().max(120),
      }),
    )
    .min(1)
    .max(64),
  warnings: z.array(z.string()).max(100),
});
export function assertTranscriptionConfigured() {
  if (
    !process.env.TRANSCRIPTION_PROVIDER_URL &&
    !existsSync(join(process.cwd(), "runtime/transcription-worker.cjs"))
  )
    throw new ApiError(
      503,
      "Prepara los modelos internos con npm run prepare:transcription antes de iniciar el servidor.",
    );
}
async function provider<T>(
  url: string | undefined,
  input: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!url || !url.startsWith("https://"))
    throw new ApiError(503, "El adaptador requiere un proveedor HTTPS");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.AUDIO_PROVIDER_API_KEY
        ? { Authorization: `Bearer ${process.env.AUDIO_PROVIDER_API_KEY}` }
        : {}),
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`El proveedor de audio respondió ${response.status}`);
  const text = await response.text();
  if (text.length > 1_000_000)
    throw new Error("Respuesta de audio demasiado grande");
  return schema.parse(JSON.parse(text));
}
export async function separateSources(
  uid: string,
  projectId: string,
  audioPath: string,
  expiresAt: string,
  maxSources: number,
) {
  const audioUrl = await signedRead(uid, projectId, audioPath, expiresAt);
  const result = await provider(
    process.env.SEPARATION_PROVIDER_URL,
    {
      audioUrl,
      outputPrefix: `temporary/${uid}/${projectId}/stems/`,
      maxSources,
    },
    separationSchema,
  );
  if (result.sources.length > maxSources)
    throw new Error("El proveedor excedió el límite de fuentes");
  result.sources.forEach((s) =>
    assertStorageOwner(s.storagePath, uid, projectId),
  );
  return result;
}
export async function transcribeAudio(
  uid: string,
  projectId: string,
  audioPath: string,
  expiresAt: string,
  context: Record<string, unknown>,
): Promise<MusicDocument> {
  assertTranscriptionConfigured();
  const audioUrl = await signedRead(uid, projectId, audioPath, expiresAt);
  return provider(
    process.env.TRANSCRIPTION_PROVIDER_URL,
    { audioUrl, ...context, ppq: 128, evidenceRequired: true },
    documentSchema,
  );
}
