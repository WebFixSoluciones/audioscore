import { AuthForm } from "@/components/auth/AuthForm";
import { notFound } from "next/navigation";
export function generateStaticParams() {
  return ["login", "register", "forgot-password", "verify-email"].map(
    (mode) => ({ mode }),
  );
}
export default async function AuthPage({
  params,
}: {
  params: Promise<{ mode: string }>;
}) {
  const { mode } = await params;
  if (!["login", "register", "forgot-password", "verify-email"].includes(mode))
    notFound();
  return (
    <AuthForm
      mode={mode as "login" | "register" | "forgot-password" | "verify-email"}
    />
  );
}
