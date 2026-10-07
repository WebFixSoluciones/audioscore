import { Shell } from "@/components/layout/Shell";
import { PLANS } from "@/lib/billing/plans";
import Link from "next/link";
import { Check, ArrowUpRight } from "lucide-react";
export default function Pricing() {
  return (
    <Shell>
      <div className="content-page">
        <div className="eyebrow">MÁS ESPACIO PARA TU MÚSICA</div>
        <h1>Un plan para cada ritmo.</h1>
        <p className="page-subtitle">
          Minutos de análisis, proyectos y herramientas de revisión. Los límites
          se verifican en el servidor antes de iniciar cada trabajo.
        </p>
        <div className="pricing-grid">
          {PLANS.map((p) => (
            <div
              key={p.id}
              className={`price-card ${p.id === "pro" ? "featured" : ""}`}
            >
              {p.id === "pro" && (
                <span className="price-badge">PARA CREAR SIN PAUSA</span>
              )}
              <h2>{p.name}</h2>
              <div className="price">
                ${p.priceMonthly}
                <small> / mes</small>
              </div>
              <p>
                {p.monthlyAudioMinutes} minutos de audio al mes
                <br />
                Hasta {p.maxFileDurationSeconds / 60} min por archivo
              </p>
              <Link
                className={`button ${p.id === "pro" ? "primary" : "secondary"}`}
                href="/auth/register"
              >
                Crear cuenta
                <ArrowUpRight size={13} />
              </Link>
              {[
                `${p.maxProjects} proyectos`,
                `Hasta ${p.maxSources} fuentes`,
                `${p.maxConcurrentJobs} trabajos simultáneos`,
                `Resultados hasta ${p.retentionDays} días`,
                p.features.manualCorrection
                  ? "Corrección manual"
                  : "Revisión de resultados",
                p.features.sourceSeparation
                  ? "Separación de fuentes"
                  : "Análisis del original",
                p.features.fullScoreExport
                  ? "Exportación global"
                  : "Exportación individual",
              ].map((f) => (
                <div className="plan-feature" key={f}>
                  <Check size={12} />
                  {f}
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="pricing-note">
          Precios de configuración inicial. Los planes de pago se asignan
          mediante administración; no hay cobro automático integrado.
          Originales, stems y ZIP caducan como máximo en 24 horas. Las demás
          exportaciones caducan según el plan, hasta 7 días.
        </p>
      </div>
    </Shell>
  );
}
