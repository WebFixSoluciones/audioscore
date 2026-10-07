import type { Plan } from "@/lib/billing/plans";
export const AUDIO_MIMES: Record<string, string[]> = {
  mp3: ["audio/mpeg", "audio/mp3"],
  wav: ["audio/wav", "audio/x-wav", "audio/wave"],
  flac: ["audio/flac", "audio/x-flac"],
  m4a: ["audio/mp4", "audio/x-m4a"],
  aac: ["audio/aac"],
  ogg: ["audio/ogg", "application/ogg"],
  aiff: ["audio/aiff", "audio/x-aiff"],
  aif: ["audio/aiff", "audio/x-aiff"],
};
export function validateAudioFile(
  name: string,
  mime: string,
  size: number,
  plan?: Pick<Plan, "maxFileBytes">,
) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!AUDIO_MIMES[ext]?.includes(mime))
    throw new Error("Extensión o tipo de audio no compatible");
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > (plan?.maxFileBytes ?? 250 * 1024 * 1024)
  )
    throw new Error("Tamaño de archivo fuera del límite");
  return ext;
}
