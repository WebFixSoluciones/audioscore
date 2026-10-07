"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AudioLines,
  ArrowUpRight,
  ShieldCheck,
  LoaderCircle,
} from "lucide-react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithPopup,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { clientFirebase, api, firebaseConfigured } from "@/lib/firebase/client";
import { messageOf } from "@/lib/utils/errors";
type Mode = "login" | "register" | "forgot-password" | "verify-email";
const titles: Record<Mode, string> = {
  login: "Vuelve a tu música.",
  register: "Tu próximo arreglo empieza aquí.",
  "forgot-password": "Recupera tu acceso.",
  "verify-email": "Confirma tu correo.",
};
export function AuthForm({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  async function establish() {
    const user = clientFirebase().auth.currentUser;
    if (!user) throw new Error("Inicia sesión para continuar.");
    await api("/api/auth/session", {
      method: "POST",
      body: JSON.stringify({ idToken: await user.getIdToken(true) }),
    });
    router.push(user.emailVerified ? "/dashboard" : "/auth/verify-email");
    router.refresh();
  }
  async function execute(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(
        code === "auth/invalid-credential"
          ? "El correo o la contraseña no coinciden."
          : code === "auth/email-already-in-use"
            ? "Este correo ya tiene una cuenta. Inicia sesión."
            : code === "auth/weak-password"
              ? "Usa una contraseña de al menos 10 caracteres."
              : code === "auth/popup-closed-by-user"
                ? "La ventana de Google se cerró. Puedes volver a intentarlo."
                : messageOf(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-story">
        <Link href="/" className="brand">
          <span className="brand-symbol">
            <AudioLines size={25} />
          </span>
          <span>
            AudioScore<span className="brand-ai">AI</span>
          </span>
        </Link>
        <h1>
          Escucha una idea.
          <br />
          <span>
            Escribe lo que
            <br />
            viene después.
          </span>
        </h1>
        <p>
          Tu espacio para transformar la escucha en música: audio, eventos y
          partituras, conectados.
        </p>
        <div className="auth-promise">
          <ShieldCheck size={20} />
          Sesiones seguras. Archivos temporales. Tu música.
        </div>
      </div>
      <section className="auth-card">
        <div className="eyebrow">TU ESPACIO MUSICAL</div>
        <h2>{titles[mode]}</h2>
        <p>
          {mode === "register"
            ? "Crea una cuenta con el plan Free para comenzar."
            : mode === "verify-email"
              ? "Abre el enlace que enviamos a tu correo. Después vuelve a iniciar sesión para actualizar la verificación."
              : mode === "forgot-password"
                ? "Te enviaremos un enlace si el correo corresponde a una cuenta."
                : "Inicia sesión para recuperar tus proyectos y análisis."}
        </p>
        {!firebaseConfigured && (
          <div className="auth-config">
            Firebase aún no está configurado. Puedes analizar y transcribir
            audio, importar MIDI y editar notas sin cuenta en el{" "}
            <Link href="/studio">
              <u>estudio local</u>
            </Link>
            .
          </div>
        )}
        {mode === "verify-email" ? (
          <div className="form">
            <button
              className="button primary"
              disabled={busy || !firebaseConfigured}
              onClick={() =>
                void execute(async () => {
                  const user = clientFirebase().auth.currentUser;
                  if (!user)
                    throw new Error("Inicia sesión para reenviar el correo.");
                  await sendEmailVerification(user);
                  setMessage("Correo de verificación reenviado.");
                })
              }
            >
              Reenviar verificación
            </button>
            <Link className="button secondary" href="/auth/login">
              Ya verifiqué · iniciar sesión
            </Link>
          </div>
        ) : (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void execute(async () => {
                const { auth } = clientFirebase();
                if (mode === "forgot-password") {
                  await sendPasswordResetEmail(auth, email).catch((e) => {
                    if (
                      !["auth/user-not-found", "auth/invalid-email"].includes(
                        e.code,
                      )
                    )
                      throw e;
                  });
                  setMessage(
                    "Si existe la cuenta, recibirás un enlace para recuperar el acceso.",
                  );
                  return;
                }
                await setPersistence(auth, browserLocalPersistence);
                if (mode === "register") {
                  const result = await createUserWithEmailAndPassword(
                    auth,
                    email,
                    password,
                  );
                  await sendEmailVerification(result.user);
                } else await signInWithEmailAndPassword(auth, email, password);
                await establish();
              });
            }}
          >
            <label>
              Correo electrónico
              <input
                autoComplete="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@estudio.com"
              />
            </label>
            {mode !== "forgot-password" && (
              <label>
                Contraseña
                <input
                  type="password"
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                  required
                  minLength={mode === "register" ? 10 : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === "register"
                      ? "Al menos 10 caracteres"
                      : "Tu contraseña"
                  }
                />
              </label>
            )}
            {mode === "login" && (
              <Link className="form-link" href="/auth/forgot-password">
                ¿Olvidaste tu contraseña?
              </Link>
            )}
            <button
              className="button primary"
              disabled={busy || !firebaseConfigured}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ArrowUpRight size={16} />
              )}{" "}
              {mode === "register"
                ? "Crear cuenta"
                : mode === "forgot-password"
                  ? "Enviar enlace"
                  : "Iniciar sesión"}
            </button>
          </form>
        )}
        {["login", "register"].includes(mode) && (
          <>
            <div className="divider">O CONTINÚA CON</div>
            <button
              className="button secondary"
              style={{ width: "100%" }}
              disabled={busy || !firebaseConfigured}
              onClick={() =>
                void execute(async () => {
                  const { auth } = clientFirebase();
                  await setPersistence(auth, browserLocalPersistence);
                  await signInWithPopup(auth, new GoogleAuthProvider());
                  await establish();
                })
              }
            >
              Google <ArrowUpRight size={14} />
            </button>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <p className="form-link">
          {mode === "register" ? (
            <Link href="/auth/login">¿Ya tienes cuenta? Inicia sesión</Link>
          ) : (
            <Link href="/auth/register">¿Primera vez aquí? Crea tu cuenta</Link>
          )}
        </p>
      </section>
    </main>
  );
}
