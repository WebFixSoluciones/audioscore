import Link from "next/link";
import { requireAccount } from "@/lib/security/auth-guard";
import { UsageMeter } from "@/components/billing/UsageMeter";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/utils/errors";
export default async function Dashboard() {
  const account = await requireAccount().catch((error: unknown) => {
    if (error instanceof ApiError && [401, 403, 503].includes(error.status))
      redirect("/auth/login");
    throw error;
  });
  return (
    <div className="content-page">
      <div className="eyebrow">TU ESPACIO MUSICAL</div>
      <h1>Dashboard</h1>
      <p className="page-subtitle">
        {account.email} · Tus proyectos, herramientas y consumo.
      </p>
      <div className="dashboard-grid">
        <Link className="detail-card dashboard-card" href="/dashboard/studio">
          <h2>Estudio musical</h2>
          <p>
            Sube audio, analiza instrumentos, revisa notas y exporta MIDI y
            partituras.
          </p>
          <span>Abrir estudio →</span>
        </Link>
        <Link className="detail-card dashboard-card" href="/dashboard/projects">
          <h2>Mis proyectos</h2>
          <p>
            {account.projectCount} proyectos · {account.activeJobs} trabajos
            activos.
          </p>
          <span>Gestionar proyectos →</span>
        </Link>
        {account.role === "admin" && (
          <Link className="detail-card dashboard-card" href="/admin">
            <h2>Administración</h2>
            <p>Administra usuarios registrados, planes y límites de uso.</p>
            <span>Abrir administración →</span>
          </Link>
        )}
      </div>
      <UsageMeter />
    </div>
  );
}
