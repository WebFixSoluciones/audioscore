import "server-only";
import { ApiError } from "@/lib/utils/errors";
export async function localBackend<T>(path: string, uid: string): Promise<T> {
  if (process.env.LOCAL_AUDIO_ENABLED !== "1" || process.env.VERCEL === "1")
    throw new ApiError(404, "El motor local no está disponible");
  const response = await fetch(`http://127.0.0.1:8765/${path}`, {
    headers: {
      "x-local-token": process.env.LOCAL_AUDIO_TOKEN || "",
      "x-local-user": encodeURIComponent(uid),
    },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      result.error || "No se pudo abrir el proyecto",
    );
  return result as T;
}
