"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/firebase/client";
import {
  exportFormats,
  featureNames,
  planSchema,
  type Plan,
} from "@/lib/billing/plans";
import { messageOf } from "@/lib/utils/errors";
const labels = {
  priceMonthly: "Precio mensual (USD)",
  monthlyAudioMinutes: "Minutos de audio al mes",
  maxFileDurationSeconds: "Duración máxima por archivo (segundos)",
  maxFileBytes: "Tamaño máximo por archivo (bytes)",
  maxProjects: "Proyectos",
  maxSources: "Fuentes musicales",
  maxConcurrentJobs: "Trabajos simultáneos",
  retentionDays: "Retención de resultados (días)",
} as const;
const features = {
  advancedAnalysis: "Análisis avanzado",
  manualCorrection: "Corrección manual",
  priorityProcessing: "Procesamiento prioritario",
  batchProcessing: "Procesamiento por lotes",
  sourceSeparation: "Separación de fuentes",
  fullScoreExport: "Exportación de partitura completa",
};
export function AdminPlans() {
  const [plans, setPlans] = useState<Plan[]>([]),
    [draft, setDraft] = useState<Plan>(),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    void api<{ plans: Plan[] }>("/api/admin/plans")
      .then((r) => setPlans(r.plans))
      .catch((e) => setError(messageOf(e)))
      .finally(() => setLoading(false));
  }, []);
  return (
    <>
      <h2>Planes</h2>
      <p className="page-subtitle">
        Los límites guardados se aplican a las siguientes operaciones de los
        usuarios. Editar un precio no genera un cobro.
      </p>
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
      {loading ? (
        <p role="status">Cargando planes…</p>
      ) : (
        <div className="dashboard-grid">
          {plans.map((plan) => (
            <button
              key={plan.id}
              className="detail-card dashboard-card"
              onClick={() => {
                setDraft(structuredClone(plan));
                setMessage("");
                setError("");
              }}
            >
              <h3>{plan.name}</h3>
              <p>
                ${plan.priceMonthly} / mes · {plan.monthlyAudioMinutes} minutos
              </p>
              <span>Editar plan →</span>
            </button>
          ))}
        </div>
      )}
      {!loading && !plans.length && !error && (
        <p>
          No hay planes inicializados. Ejecuta la inicialización del proyecto
          antes de asignar planes.
        </p>
      )}
      {draft && (
        <form
          className="detail-card form admin-plan-form"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            void Promise.resolve()
              .then(() => planSchema.parse(draft))
              .then((plan) =>
                api("/api/admin/plans/" + plan.id, {
                  method: "PATCH",
                  body: JSON.stringify(plan),
                }),
              )
              .then(() => {
                setPlans((rows) =>
                  rows.map((p) =>
                    p.id === draft.id ? structuredClone(draft) : p,
                  ),
                );
                setMessage(
                  "Plan guardado. Sus límites ya están disponibles para las siguientes operaciones.",
                );
                setDraft(undefined);
              })
              .catch((e) => setError(messageOf(e)))
              .finally(() => setBusy(false));
          }}
        >
          <h3>Editar {draft.name}</h3>
          <label>
            Nombre
            <input
              value={draft.name}
              required
              maxLength={80}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <div className="admin-field-grid">
            {Object.entries(labels).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  required
                  min={key === "priceMonthly" ? 0 : 1}
                  max={
                    key === "retentionDays"
                      ? 7
                      : key === "maxSources"
                        ? 64
                        : undefined
                  }
                  step={key === "priceMonthly" ? "0.01" : 1}
                  value={draft[key as keyof typeof labels]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <fieldset>
            <legend>Exportaciones incluidas</legend>
            <div className="admin-options">
              {exportFormats.map((format) => (
                <label key={format}>
                  <input
                    type="checkbox"
                    checked={draft.allowedExports.includes(format)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        allowedExports: e.target.checked
                          ? [...draft.allowedExports, format]
                          : draft.allowedExports.filter((f) => f !== format),
                      })
                    }
                  />
                  {format.toUpperCase()}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Funciones incluidas</legend>
            <div className="admin-options">
              {featureNames.map((feature) => (
                <label key={feature}>
                  <input
                    type="checkbox"
                    checked={draft.features[feature]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        features: {
                          ...draft.features,
                          [feature]: e.target.checked,
                        },
                      })
                    }
                  />
                  {features[feature]}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="page-subtitle">
            Las funciones que requieren un servicio externo estarán disponibles
            cuando su integración esté configurada.
          </p>
          <div className="admin-actions">
            <button className="button primary" disabled={busy}>
              {busy ? "Guardando…" : "Guardar cambios"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setDraft(undefined)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </>
  );
}
