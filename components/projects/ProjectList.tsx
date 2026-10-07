"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/firebase/client";
import { signOut } from "firebase/auth";
import { clientFirebase } from "@/lib/firebase/client";
import { FolderOpen, Plus, AudioLines, LogOut } from "lucide-react";
import type { Project } from "@/lib/music/types";
import { messageOf } from "@/lib/utils/errors";
export function ProjectList() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    void api<{ projects: Project[] }>("/api/projects")
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(messageOf(e)))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="content-page">
      <div className="section-heading">
        <div>
          <div className="eyebrow">TU BIBLIOTECA MUSICAL</div>
          <h1>Mis proyectos</h1>
          <p className="page-subtitle">
            Tus arreglos, transcripciones y revisiones, en un solo lugar.
          </p>
        </div>
        <Link className="button primary" href="/dashboard/projects/new">
          <Plus size={15} />
          Nuevo proyecto
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
          <h2>Hagamos espacio para tu música.</h2>
          <p>
            Crea tu primer proyecto y sube un audio temporal
            <br />
            para iniciar el flujo de análisis.
          </p>
          <Link className="button secondary" href="/dashboard/projects/new">
            <Plus size={14} />
            Crear proyecto
          </Link>
        </div>
      ) : (
        <div className="project-list">
          {projects.map((p) => (
            <Link
              className="project-card"
              key={p.id}
              href={`/dashboard/projects/${p.id}`}
            >
              <div className="project-card-top">
                <AudioLines size={22} />
                <span className="status-chip">{p.status}</span>
              </div>
              <h3>{p.title}</h3>
              <p>
                {new Date(p.createdAt).toLocaleDateString("es-EC", {
                  timeZone: "America/Guayaquil",
                })}
              </p>
              <p>
                {p.durationSeconds
                  ? `${Math.round(p.durationSeconds)} s`
                  : "Sin audio"}{" "}
                · {p.document?.sources.length ?? 0} pistas
              </p>
            </Link>
          ))}
        </div>
      )}
      <button
        className="text-button"
        style={{ marginTop: 30 }}
        onClick={() =>
          void api("/api/auth/session", { method: "DELETE" })
            .then(async () => {
              await signOut(clientFirebase().auth);
              router.push("/auth/login");
              router.refresh();
            })
            .catch((e) => setError(messageOf(e)))
        }
      >
        <LogOut size={14} />
        Cerrar sesión
      </button>
    </div>
  );
}
