"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/firebase/client";
import { messageOf } from "@/lib/utils/errors";
import { Download, FileMusic } from "lucide-react";
import Link from "next/link";
type Asset = {
  id: string;
  fileType: string;
  expiresAt: string;
  bytes: number;
  revision: number;
};
export function Exports({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]),
    [error, setError] = useState(""),
    [now, setNow] = useState(0);
  useEffect(() => {
    const refresh = () => {
      setNow(Date.now());
      void api<{ exports: Asset[] }>(`/api/projects/${projectId}/exports`)
        .then((r) => setAssets(r.exports))
        .catch((e) => setError(messageOf(e)));
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [projectId]);
  return (
    <div className="content-page">
      <div className="eyebrow">TU MÚSICA, LISTA PARA LLEVAR</div>
      <h1>Exportaciones</h1>
      <p className="page-subtitle">
        Cada archivo corresponde a una revisión de los eventos musicales.
        Descarga los resultados antes de su caducidad.
      </p>
      <Link
        className="button secondary"
        href={`/dashboard/projects/${projectId}`}
      >
        Volver al editor
      </Link>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {!assets.length && (
        <div className="empty-page">
          <FileMusic size={35} />
          <h2>Todavía no hay exportaciones.</h2>
          <p>Selecciona un formato en el editor para iniciar su generación.</p>
        </div>
      )}
      {assets.map((a) => (
        <div className="asset-card" key={a.id}>
          <div>
            <strong>
              {a.fileType.toUpperCase()} · Revisión {a.revision}
            </strong>
            <p>
              {(a.bytes / 1024).toFixed(1)} KB · Caduca{" "}
              {new Date(a.expiresAt).toLocaleString("es-EC", {
                timeZone: "America/Guayaquil",
              })}
            </p>
          </div>
          <button
            className="button primary small"
            disabled={Date.parse(a.expiresAt) < now}
            onClick={() => {
              const target = window.open("about:blank", "_blank");
              if (target) target.opener = null;
              void api<{ url: string }>(
                `/api/projects/${projectId}/download/${a.id}`,
              )
                .then((r) => {
                  if (target) target.location.href = r.url;
                  else window.location.assign(r.url);
                })
                .catch((e) => {
                  target?.close();
                  setError(messageOf(e));
                });
            }}
          >
            <Download size={14} />
            {Date.parse(a.expiresAt) < now ? "Caducado" : "Descargar"}
          </button>
        </div>
      ))}
    </div>
  );
}
