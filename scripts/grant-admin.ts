import { adminFirebase } from "../lib/firebase/admin";
async function main() {
  const email = process.argv[2]?.trim();
  if (!email || !email.includes("@"))
    throw new Error(
      "Indica el correo de una cuenta registrada: npm run admin:grant -- correo@ejemplo.com",
    );
  const { auth } = adminFirebase();
  const user = await auth.getUserByEmail(email);
  if (user.disabled || !user.emailVerified)
    throw new Error(
      "La cuenta debe estar activa y tener el correo verificado antes de asignar administración.",
    );
  await auth.setCustomUserClaims(user.uid, {
    ...user.customClaims,
    admin: true,
  });
  console.log(
    "Permiso administrativo asignado. Cierra sesión y vuelve a ingresar para actualizar los permisos.",
  );
}
void main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
