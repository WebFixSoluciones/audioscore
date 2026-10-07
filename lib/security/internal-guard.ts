import "server-only";
import { timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { ApiError } from "@/lib/utils/errors";
export async function requireInternal(request: Request) {
  const expected = process.env.INTERNAL_JOB_SECRET,
    provided = request.headers.get("X-Internal-Secret");
  if (
    !expected ||
    expected.length < 32 ||
    !provided ||
    Buffer.byteLength(expected) !== Buffer.byteLength(provided) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  )
    throw new ApiError(401, "Trabajo interno no autorizado");
  const token = request.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (
    !token ||
    !process.env.WORKER_URL ||
    !process.env.CLOUD_TASKS_SERVICE_ACCOUNT
  )
    throw new ApiError(401, "Falta identidad del worker");
  try {
    const ticket = await new OAuth2Client().verifyIdToken({
      idToken: token,
      audience: process.env.WORKER_URL.replace(/\/$/, ""),
    });
    const claims = ticket.getPayload();
    if (
      claims?.email !== process.env.CLOUD_TASKS_SERVICE_ACCOUNT ||
      !claims.email_verified
    )
      throw new Error("Identidad inválida");
  } catch {
    throw new ApiError(401, "Identidad del worker inválida");
  }
}
