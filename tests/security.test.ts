import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  session: "verified-cookie" as string | undefined,
  uid: "owner",
  verified: true,
  admin: false,
  status: "active",
  appCheck: true,
  cookieValid: true,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (state.session ? { value: state.session } : undefined),
  }),
}));
vi.mock("@/lib/firebase/admin", () => ({
  adminFirebase: () => ({
    auth: {
      verifySessionCookie: async () => {
        if (!state.cookieValid) throw new Error("revoked");
        return {
          uid: state.uid,
          email: "test@example.test",
          email_verified: state.verified,
          admin: state.admin,
        };
      },
    },
    appCheck: {
      verifyToken: async () => {
        if (!state.appCheck) throw new Error("invalid");
      },
    },
    db: {
      doc: (path: string) => ({
        get: async () => ({
          exists: true,
          id: path.split("/").pop(),
          data: () =>
            path.endsWith("projects/project-1")
              ? { userId: "owner", title: "Private" }
              : {
                  status: state.status,
                  planId: "free",
                  subscriptionStatus: "active",
                },
        }),
      }),
    },
  }),
}));
import {
  requireAccount,
  requireAdmin,
  assertOrigin,
  verifyAppCheck,
} from "@/lib/security/auth-guard";
import { ownedProject, safeId } from "@/lib/security/ownership";
import { featureAllowed, exportAllowed } from "@/lib/security/plan-guard";
import { getDefaultPlan } from "@/lib/billing/plans";
beforeEach(() =>
  Object.assign(state, {
    session: "verified-cookie",
    uid: "owner",
    verified: true,
    admin: false,
    status: "active",
    appCheck: true,
    cookieValid: true,
  }),
);
describe("sesiones y acceso privado", () => {
  it("permite el arranque local sin App Check solo con configuración explícita y conserva la autenticación", async () => {
    vi.stubEnv("APP_CHECK_ENFORCED", "false");
    try {
      await expect(
        verifyAppCheck(new Request("http://localhost:3000")),
      ).resolves.toBeUndefined();
      state.session = undefined;
      await expect(
        requireAccount(new Request("http://localhost:3000")),
      ).rejects.toThrow("Inicia sesión");
      state.appCheck = false;
      await expect(
        verifyAppCheck(
          new Request("http://localhost:3000", {
            headers: { "X-Firebase-AppCheck": "invalid" },
          }),
        ),
      ).rejects.toThrow("App Check inválido");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("usa el UID de la cookie verificada y descarta userId del payload", async () => {
    const account = await requireAccount(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "X-Firebase-AppCheck": "valid",
        },
        body: JSON.stringify({ userId: "victim" }),
      }),
    );
    expect(account.uid).toBe("owner");
  });
  it("rechaza sesión ausente o revocada", async () => {
    state.session = undefined;
    await expect(requireAccount()).rejects.toThrow("Inicia sesión");
    state.session = "revoked";
    state.cookieValid = false;
    await expect(requireAccount()).rejects.toThrow("caducado");
  });
  it("rechaza cuenta suspendida incluso con claim admin", async () => {
    state.admin = true;
    state.status = "suspended";
    await expect(requireAccount()).rejects.toThrow("Cuenta no disponible");
  });
  it("requiere email verificado y App Check válido", async () => {
    state.verified = false;
    await expect(requireAccount()).rejects.toThrow("Verifica tu correo");
    state.verified = true;
    await expect(
      requireAccount(new Request("http://localhost:3000/api/projects")),
    ).rejects.toThrow("App Check");
    state.appCheck = false;
    await expect(
      requireAccount(
        new Request("http://localhost:3000/api/projects", {
          headers: { "X-Firebase-AppCheck": "bad" },
        }),
      ),
    ).rejects.toThrow("App Check inválido");
  });
  it("rechaza proyecto ajeno, IDs con slash y origen ajeno", async () => {
    await expect(ownedProject("other-user", "project-1")).rejects.toThrow(
      "Proyecto no encontrado",
    );
    expect(() => safeId("../project-1")).toThrow();
    expect(() =>
      assertOrigin(
        new Request("http://localhost:3000", {
          headers: { origin: "https://attacker.test" },
        }),
      ),
    ).toThrow();
  });
  it("los privilegios y exportaciones de plan se comprueban en servidor", async () => {
    const account = await requireAccount();
    expect(() => requireAdmin(account)).toThrow();
    const free = getDefaultPlan("free");
    expect(() => featureAllowed(free, "manualCorrection")).toThrow();
    expect(() => exportAllowed(free, "pdf", true)).toThrow();
    expect(() => exportAllowed(free, "midi", false)).not.toThrow();
  });
});
