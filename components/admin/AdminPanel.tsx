"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/firebase/client";
import { messageOf } from "@/lib/utils/errors";
import { PLANS } from "@/lib/billing/plans";
export function AdminPanel({ section }: { section: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    void api<Record<string, unknown>>(`/api/admin/${section}`)
      .then((r) => {
        const result = Object.values(r)[0];
        setRows(
          Array.isArray(result) ? result : [result as Record<string, unknown>],
        );
      })
      .catch((e) => setError(messageOf(e)));
  }, [section]);
  const fields: Record<string, string[]> = {
    users: ["email", "status", "planId", "activeJobs"],
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
  return (
    <>
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
                <th key={c}>{c}</th>
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
                      onChange={(e) => {
                        const planId = e.target.value;
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
                          .catch((e) => setError(messageOf(e)));
                      }}
                    >
                      {PLANS.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Estado de ${r.email}`}
                      value={String(r.status)}
                      onChange={(e) => {
                        const status = e.target.value;
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
                          .catch((e) => setError(messageOf(e)));
                      }}
                    >
                      {["active", "suspended", "deleted"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
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
      {!rows.length && (
        <p className="page-subtitle">Todavía no hay registros.</p>
      )}
    </>
  );
}
