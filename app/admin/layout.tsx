import { requireAccount, requireAdmin } from "@/lib/security/auth-guard";
import { ApiError } from "@/lib/utils/errors";
import { redirect } from "next/navigation";
import { Shell } from "@/components/layout/Shell";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let account;
  try {
    account = await requireAccount();
    requireAdmin(account);
  } catch (e) {
    if (e instanceof ApiError)
      redirect(e.status === 403 ? "/dashboard" : "/auth/login");
    throw e;
  }
  return (
    <Shell account={{ email: account.email, isAdmin: true }}>
      <div className="content-page">
        <div className="eyebrow">CONTROL DEL ESPACIO MUSICAL</div>
        <h1>Administración</h1>
        <div className="admin-nav">
          {[
            "overview",
            "users",
            "plans",
            "jobs",
            "usage",
            "logs",
            "settings",
          ].map((s, i) => (
            <Link key={s} href={`/admin/${s}`}>
              {
                [
                  "Resumen",
                  "Usuarios",
                  "Planes",
                  "Jobs",
                  "Consumo",
                  "Logs",
                  "Configuración",
                ][i]
              }
            </Link>
          ))}
        </div>
        {children}
      </div>
    </Shell>
  );
}
