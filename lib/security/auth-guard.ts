import "server-only";
import { cookies } from "next/headers";
import { adminFirebase } from "@/lib/firebase/admin";
import { ApiError } from "@/lib/utils/errors";
export const sessionName = () =>
  process.env.SESSION_COOKIE_NAME || "audioscore_session";
export type Account = {
  uid: string;
  email: string;
  role: string;
  planId: string;
  status: string;
  subscriptionStatus: string;
  projectCount: number;
  activeJobs: number;
};
export function assertOrigin(request: Request) {
  const allowed = new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  ).origin;
  if (request.headers.get("origin") !== allowed)
    throw new ApiError(403, "Origen de solicitud no autorizado");
}
export async function verifyAppCheck(request: Request) {
  const token = request.headers.get("X-Firebase-AppCheck");
  if (!token && process.env.APP_CHECK_ENFORCED === "false") return;
  if (!token) throw new ApiError(403, "Falta la verificación App Check");
  try {
    await adminFirebase().appCheck.verifyToken(token);
  } catch {
    throw new ApiError(403, "App Check inválido");
  }
}
export async function requireAccount(request?: Request): Promise<Account> {
  const { auth, db } = adminFirebase();
  const session = (await cookies()).get(sessionName())?.value;
  if (!session) throw new ApiError(401, "Inicia sesión para continuar");
  let claims;
  try {
    claims = await auth.verifySessionCookie(session, true);
  } catch {
    throw new ApiError(401, "Tu sesión ha caducado");
  }
  const user = (await db.doc(`users/${claims.uid}`).get()).data();
  if (!user || user.status !== "active")
    throw new ApiError(403, "Cuenta no disponible");
  if (!claims.email_verified)
    throw new ApiError(403, "Verifica tu correo antes de continuar");
  if (request) {
    if (!["GET", "HEAD"].includes(request.method)) assertOrigin(request);
    await verifyAppCheck(request);
  }
  return {
    uid: claims.uid,
    email: claims.email ?? "",
    role: claims.admin === true ? "admin" : "user",
    planId: user.planId,
    status: user.status,
    subscriptionStatus: user.subscriptionStatus,
    projectCount: user.projectCount ?? 0,
    activeJobs: user.activeJobs ?? 0,
  };
}
export function requireAdmin(account: Account) {
  if (account.role !== "admin")
    throw new ApiError(403, "Se requiere acceso de administrador");
}
