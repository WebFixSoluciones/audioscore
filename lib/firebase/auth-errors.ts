import { messageOf } from "@/lib/utils/errors";

export function isAppCheckError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === "string" && code.startsWith("appCheck/");
}

export function authErrorMessage(error: unknown) {
  if (isAppCheckError(error))
    return "No pudimos validar el acceso en esta pestaña. Recarga y continúa para volver a intentarlo.";
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case "auth/invalid-credential":
      return "El correo o la contraseña no coinciden.";
    case "auth/email-already-in-use":
      return "Este correo ya tiene una cuenta. Inicia sesión.";
    case "auth/weak-password":
      return "Usa una contraseña de al menos 10 caracteres.";
    case "auth/popup-closed-by-user":
      return "La ventana de Google se cerró. Puedes volver a intentarlo.";
    default:
      return messageOf(error);
  }
}
