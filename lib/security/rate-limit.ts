import "server-only";
import { adminFirebase } from "@/lib/firebase/admin";
import { createHash } from "node:crypto";
import { ApiError } from "@/lib/utils/errors";
export async function rateLimit(uid: string, action: string, max = 30) {
  const now = Date.now(),
    window = Math.floor(now / 60000);
  const ref = adminFirebase().db.doc(
    `rateLimits/${createHash("sha256").update(`${uid}:${action}`).digest("hex")}`,
  );
  await adminFirebase().db.runTransaction(async (tx) => {
    const record = (await tx.get(ref)).data();
    const count = record?.window === window ? record.count : 0;
    if (count >= max)
      throw new ApiError(
        429,
        "Demasiadas solicitudes. Inténtalo en un minuto.",
      );
    tx.set(ref, {
      count: count + 1,
      window,
      expiresAt: new Date(now + 120000),
      updatedAt: new Date().toISOString(),
    });
  });
}
