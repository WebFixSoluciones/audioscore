"use client";
import { useEffect, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { localRequest } from "@/lib/audio/local/client";
import type { LocalJob } from "@/lib/audio/local/types";
export function LocalLibrary({
  onOpen,
  busy,
  refreshKey,
}: {
  onOpen: (id: string) => void;
  busy: boolean;
  refreshKey?: string;
}) {
  const [jobs, setJobs] = useState<LocalJob[]>([]),
    [error, setError] = useState("");
  async function refresh() {
    try {
      const result = await localRequest<{ jobs: LocalJob[] }>("jobs");
      setJobs(result.jobs);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Motor local apagado");
    }
  }
  useEffect(() => {
    let stopped = false;
    const update = async () => {
      try {
        const result = await localRequest<{ jobs: LocalJob[] }>("jobs");
        if (!stopped) {
          setJobs(result.jobs);
          setError("");
        }
      } catch (e) {
        if (!stopped)
          setError(e instanceof Error ? e.message : "Motor local apagado");
      }
    };
    void update();
    const interval = setInterval(() => void update(), 10000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [refreshKey, busy]);
  return (
    <section
      id="local-library"
      className="local-library"
      aria-label="Análisis guardados en este equipo"
    >
      <div className="panel-heading">
        <div>
          <FolderOpen size={16} />
          <strong>Guardados en este equipo</strong>
        </div>
        <button
          className="icon-button"
          aria-label="Actualizar análisis locales"
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {!jobs.length && !error && (
        <p>
          Los audios, stems y partituras aparecerán aquí después del análisis.
        </p>
      )}
      <div className="local-job-list">
        {jobs.slice(0, 12).map((job) => (
          <button
            key={job.id}
            disabled={busy || ["failed", "cancelled"].includes(job.status)}
            onClick={() => onOpen(job.id)}
            title={job.error || job.stage}
          >
            <strong>{job.title}</strong>
            <small>
              {job.status === "completed"
                ? "Abrir pistas y partitura"
                : `${job.stage} · ${job.progress}%`}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}
