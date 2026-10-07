import { createHash } from "node:crypto";
import { ApiError } from "@/lib/utils/errors";
export function idempotencyId(
  uid: string,
  projectId: string,
  key: string,
  kind: string,
) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key))
    throw new ApiError(
      400,
      "Se requiere una clave de idempotencia de 8–100 caracteres",
    );
  return createHash("sha256")
    .update(`${uid}:${projectId}:${kind}:${key}`)
    .digest("hex");
}
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
