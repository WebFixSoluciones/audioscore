import { requireAccount } from "@/lib/security/auth-guard";
import { redirect } from "next/navigation";
import { Shell } from "@/components/layout/Shell";
import { ApiError } from "@/lib/utils/errors";
export const dynamic = "force-dynamic";
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let account;
  try {
    account = await requireAccount();
  } catch (e) {
    if (e instanceof ApiError && [401, 403, 503].includes(e.status))
      redirect("/auth/login");
    throw e;
  }
  return (
    <Shell
      account={{ email: account.email, isAdmin: account.role === "admin" }}
      localMode={
        process.env.LOCAL_AUDIO_ENABLED === "1" && process.env.VERCEL !== "1"
      }
    >
      {children}
    </Shell>
  );
}
