"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/firebase/client";
import { messageOf } from "@/lib/utils/errors";
import { PLANS } from "@/lib/billing/plans";
export function AdminPanel({ section }: { section: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState<string>(),
    [plans, setPlans] = useState(PLANS),
    [cursor, setCursor] = useState<string>(),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [history, setHistory] = useState<(string | undefined)[]>([]),
    [search, setSearch] = useState(""),
    [emailFilter, setEmailFilter] = useState("");
  useEffect(() => {
    const params = new URLSearchParams();
    if (section === "users" && cursor) params.set("cursor", cursor);
    if (section === "users" && emailFilter) params.set("email", emailFilter);
    void api<Record<string, unknown>>(
      `/api/admin/${section}${params.size ? "?" + params : ""}`,
    )
      .then((r) => {
        setNextCursor(typeof r.nextCursor === "string" ? r.nextCursor : null);
        const result = Object.values(r)[0];
        setRows(
          Array.isArray(result) ? result : [result as Record<string, unknown>],
        );
      })
      .catch((e) => setError(messageOf(e)))
      .finally(() => setLoading(false));
    if (section === "users")
      void api<{ plans: typeof PLANS }>("/api/admin/plans")
        .then((r) => setPlans(r.plans))
        .catch((e) => setError(messageOf(e)));
  }, [section, cursor, emailFilter]);
  const fields: Record<string, string[]> = {
    users: ["email", "status", "planId", "subscriptionStatus", "activeJobs"],
    plans: ["name", "monthlyAudioMinutes", "maxProjects", "maxSources"],
    jobs: ["projectId", "kind", "status", "stage", "attempts"],
    usage: ["projectId", "minutesReserved", "minutesConsumed", "status"],
    logs: ["createdAt", "actor", "action", "projectId"],
    settings: [
      "originalRetentionHours",
      "stemRetentionHours",
      "maxExportRetentionDays",
    ],
  };
  const columns = fields[section] ?? [];
  const names: Record<string, string> = {
    email: "Correo",
    status: "Estado",
    planId: "Plan",
    subscriptionStatus: "Suscripción",
    activeJobs: "Trabajos activos",
    projectId: "Proyecto",
    kind: "Tipo",
    stage: "Etapa",
    attempts: "Intentos",
    minutesReserved: "Minutos reservados",
    minutesConsumed: "Minutos usados",
    createdAt: "Fecha",
    actor: "Administrador",
    action: "Acción",
    originalRetentionHours: "Retención del audio (horas)",
    stemRetentionHours: "Retención de fuentes (horas)",
    maxExportRetentionDays: "Retención de exportaciones (días)",
  };
  return (
    <>
      {section === "users" && (
        <form
          className="admin-actions"
          onSubmit={(event) => {
            event.preventDefault();
            setLoading(true);
            setError("");
            setHistory([]);
            setCursor(undefined);
            setEmailFilter(search.trim().toLowerCase());
          }}
        >
          <label>
            Buscar por correo exacto
            <input
              type="email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="correo@estudio.com"
            />
          </label>
          <button
            className="button secondary"
            disabled={
              loading ||
              Boolean(saving) ||
              search.trim().toLowerCase() === emailFilter
            }
          >
            Buscar
          </button>
          {emailFilter && (
            <button
              type="button"
              className="text-button"
              disabled={loading || Boolean(saving)}
              onClick={() => {
                setSearch("");
                setEmailFilter("");
                setCursor(undefined);
                setHistory([]);
                setLoading(true);
                setError("");
              }}
            >
              Ver todos
            </button>
          )}
        </form>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{names[c] ?? c}</th>
              ))}
              {section === "users" && <th>Asignar plan / estado</th>}
              {section === "jobs" && <th>Reintentar</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c}>{String(r[c] ?? "—")}</td>
                ))}
                {section === "users" && (
                  <td>
                    <select
                      aria-label={`Asignar plan a ${r.email}`}
                      value={String(r.planId)}
                      disabled={Boolean(saving)}
                      onChange={(e) => {
                        const planId = e.target.value;
                        setSaving(String(r.uid));
                        setError("");
                        void api(`/api/admin/users/${r.uid}`, {
                          method: "PATCH",
                          body: JSON.stringify({ planId }),
                        })
                          .then(() =>
                            setRows(
                              rows.map((x) =>
                                x.uid === r.uid ? { ...x, planId } : x,
                              ),
                            ),
                          )
                          .catch((e) => setError(messageOf(e)))
                          .finally(() => setSaving(undefined));
                      }}
                    >
                      {plans.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Estado de ${r.email}`}
                      value={String(r.status)}
                      disabled={Boolean(saving)}
                      onChange={(e) => {
                        const status = e.target.value;
                        setSaving(String(r.uid));
                        setError("");
                        void api(`/api/admin/users/${r.uid}`, {
                          method: "PATCH",
                          body: JSON.stringify({ status }),
                        })
                          .then(() =>
                            setRows(
                              rows.map((x) =>
                                x.uid === r.uid ? { ...x, status } : x,
                              ),
                            ),
                          )
                          .catch((e) => setError(messageOf(e)))
                          .finally(() => setSaving(undefined));
                      }}
                    >
                      {["active", "suspended"].map((s) => (
                        <option key={s} value={s}>
                          {s === "active" ? "Activo" : "Suspendido"}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Suscripción de ${r.email}`}
                      value={String(r.subscriptionStatus ?? "active")}
                      disabled={Boolean(saving)}
                      onChange={(e) => {
                        const subscriptionStatus = e.target.value;
                        setSaving(String(r.uid));
                        setError("");
                        void api(`/api/admin/users/${r.uid}`, {
                          method: "PATCH",
                          body: JSON.stringify({ subscriptionStatus }),
                        })
                          .then(() =>
                            setRows((current) =>
                              current.map((user) =>
                                user.uid === r.uid
                                  ? { ...user, subscriptionStatus }
                                  : user,
                              ),
                            ),
                          )
                          .catch((error) => setError(messageOf(error)))
                          .finally(() => setSaving(undefined));
                      }}
                    >
                      <option value="active">Suscripción activa</option>
                      <option value="past_due">Pago pendiente</option>
                      <option value="cancelled">Cancelada</option>
                    </select>
                  </td>
                )}
                {section === "jobs" && (
                  <td>
                    <button
                      className="text-button"
                      disabled={
                        !["failed", "cancelled"].includes(String(r.status))
                      }
                      onClick={() =>
                        void api(`/api/admin/jobs/${r.id}/retry`, {
                          method: "POST",
                          body: JSON.stringify({
                            uid: r.userId,
                            projectId: r.projectId,
                            idempotencyKey: crypto.randomUUID(),
                          }),
                        })
                          .then(() =>
                            setError(
                              "Reintento reservado y encolado según el plan actual del usuario.",
                            ),
                          )
                          .catch((e) => setError(messageOf(e)))
                      }
                    >
                      Reintentar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {section === "users" && (
        <div className="admin-actions">
          <button
            className="button secondary"
            disabled={!history.length || loading || Boolean(saving)}
            onClick={() => {
              setCursor(history.at(-1));
              setHistory((current) => current.slice(0, -1));
              setLoading(true);
              setError("");
            }}
          >
            Anterior
          </button>
          <span className="page-subtitle">
            Página {history.length + 1} · {rows.length} cuentas
          </span>
          <button
            className="button secondary"
            disabled={!nextCursor || loading || Boolean(saving)}
            onClick={() => {
              if (nextCursor) {
                setHistory((current) => [...current, cursor]);
                setCursor(nextCursor);
                setLoading(true);
                setError("");
              }
            }}
          >
            Siguiente
          </button>
        </div>
      )}
      {!rows.length && !error && (
        <p className="page-subtitle" role="status">
          {loading ? "Cargando registros…" : "Todavía no hay registros."}
        </p>
      )}
    </>
  );
}
