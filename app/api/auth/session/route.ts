import { cookies } from "next/headers";
import { z } from "zod";
import { adminFirebase } from "@/lib/firebase/admin";
import {
  assertOrigin,
  sessionName,
  verifyAppCheck,
} from "@/lib/security/auth-guard";
import { ApiError } from "@/lib/utils/errors";
import { handleApi } from "@/lib/security/response";
export const runtime = "nodejs";
export const POST = (request: Request) =>
  handleApi(async () => {
    assertOrigin(request);
    await verifyAppCheck(request);
    const { idToken } = z
      .object({ idToken: z.string().min(20).max(10000) })
      .parse(await request.json());
    const { auth, db } = adminFirebase();
    let claims;
    try {
      claims = await auth.verifyIdToken(idToken, true);
    } catch {
      throw new ApiError(401, "Credenciales inválidas");
    }
    if (Date.now() / 1000 - claims.auth_time > 300)
      throw new ApiError(
        401,
        "Vuelve a iniciar sesión para confirmar tu identidad",
      );
    const ref = db.doc(`users/${claims.uid}`);
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (doc.exists && doc.data()?.status !== "active")
        throw new ApiError(403, "Cuenta suspendida o eliminada");
      const now = new Date().toISOString();
      if (!doc.exists)
        tx.set(ref, {
          email: claims.email ?? "",
          role: "user",
          status: "active",
          planId: "free",
          subscriptionStatus: "active",
          projectCount: 0,
          activeJobs: 0,
          createdAt: now,
          updatedAt: now,
        });
      else tx.update(ref, { email: claims.email ?? "", updatedAt: now });
    });
    const expiresIn = 5 * 24 * 60 * 60 * 1000;
    const cookie = await auth.createSessionCookie(idToken, { expiresIn });
    (await cookies()).set(sessionName(), cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: expiresIn / 1000,
    });
    return {
      authenticated: true,
      emailVerified: claims.email_verified === true,
      role: claims.admin === true ? "admin" : "user",
    };
  });
export const DELETE = (request: Request) =>
  handleApi(async () => {
    assertOrigin(request);
    (await cookies()).delete(sessionName());
    return { authenticated: false };
  });
