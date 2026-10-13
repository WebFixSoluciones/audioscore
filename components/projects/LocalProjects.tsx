"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AudioLines, FolderOpen, Upload } from "lucide-react";
import { localRequest } from "@/lib/audio/local/client";
import type { LocalJob } from "@/lib/audio/local/types";
export function LocalProjects() {
  const [projects, setProjects] = useState<LocalJob[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let stopped = false;
    void localRequest<{ jobs: LocalJob[] }>("jobs")
      .then(({ jobs }) => {
        if (!stopped) setProjects(jobs);
      })
      .catch((e) => {
        if (!stopped)
          setError(
            e instanceof Error
              ? e.message
              : "No se pudieron cargar tus proyectos",
          );
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, []);
  return (
    <div className="content-page">
      <div className="section-heading">
        <div>
          <div className="eyebrow">TU BIBLIOTECA MUSICAL</div>
          <h1>Mis proyectos</h1>
          <p className="page-subtitle">
            Solo los audios que elegiste guardar. Pistas y partituras
            conservadas en este equipo.
          </p>
        </div>
        <Link className="button primary" href="/dashboard/studio">
          <Upload size={15} />
          Trabajar otro audio
        </Link>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="loading-state">Cargando proyectos…</p>
      ) : !projects.length ? (
        <div className="empty-page">
          <FolderOpen size={37} />
          <h2>Aún no has guardado proyectos.</h2>
          <p>
            Sube y analiza un audio en el estudio. Guárdalo como proyecto solo
            si deseas conservarlo aquí.
          </p>
          <Link className="button secondary" href="/dashboard/studio">
            Abrir estudio
          </Link>
        </div>
      ) : (
        <div className="project-list">
          {projects.map((project) => (
            <Link
              className="project-card"
              key={project.id}
              href={`/dashboard/projects/local/${project.id}`}
            >
              <div className="project-card-top">
                <AudioLines size={22} />
                <span className="status-chip">Guardado</span>
              </div>
              <h3>{project.title}</h3>
              <p>
                {new Date(project.savedAt!).toLocaleDateString("es-EC", {
                  timeZone: "America/Guayaquil",
                })}
              </p>
              <p>
                {Math.round(project.durationSeconds || 0)} s ·{" "}
                {project.sourceCount || 0} pistas
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
