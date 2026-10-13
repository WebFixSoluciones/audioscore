// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signIn: vi.fn().mockResolvedValue({}),
  api: vi.fn(),
  token: vi.fn().mockResolvedValue("test-id-token"),
  persistence: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: mocks.signIn,
  setPersistence: mocks.persistence,
  browserLocalPersistence: "local",
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  onAuthStateChanged: vi.fn(),
}));
vi.mock("@/lib/firebase/client", () => ({
  firebaseConfigured: true,
  api: mocks.api,
  clientFirebase: () => ({
    auth: { currentUser: { getIdToken: mocks.token } },
  }),
}));
import { AuthForm } from "@/components/auth/AuthForm";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("signs in with Firebase email/password and opens the clean local studio for a user or administrator", async () => {
  for (const role of ["user", "admin"]) {
    mocks.api.mockResolvedValueOnce({ emailVerified: true, role });
    render(createElement(AuthForm, { mode: "login", localMode: true }));
    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "test@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "test-password" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Iniciar sesión" }).closest("form")!,
    );
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/dashboard/studio"),
    );
    expect(mocks.signIn).toHaveBeenCalledWith(
      expect.anything(),
      "test@example.test",
      "test-password",
    );
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ idToken: "test-id-token" }),
      }),
    );
    cleanup();
    vi.clearAllMocks();
  }
});
