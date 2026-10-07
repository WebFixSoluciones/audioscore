"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/firebase/client";
import { messageOf } from "@/lib/utils/errors";
export function NewProject() {
  const [title, setTitle] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  const requestKey = useRef<{ title: string; key: string } | undefined>(
    undefined,
  );
  return (
    <div className="content-page">
      <div className="eyebrow">EL COMIENZO DE UN ARREGLO</div>
      <h1>Nuevo proyecto</h1>
      <p className="page-subtitle">
        Primero un nombre. Después, tu audio y las ideas que quieres explorar.
      </p>
      <form
        className="form cloud-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          if (requestKey.current?.title !== title)
            requestKey.current = { title, key: crypto.randomUUID() };
          void api<{ project: ProjectResult }>("/api/projects", {
            method: "POST",
            body: JSON.stringify({
              title,
              idempotencyKey: requestKey.current.key,
            }),
          })
            .then((r) => router.push(`/dashboard/projects/${r.project.id}`))
            .catch((e) => setError(messageOf(e)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Nombre del proyecto
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={120}
            placeholder="El nombre de tu próxima idea"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Creando…" : "Crear proyecto"}
        </button>
      </form>
    </div>
  );
}
type ProjectResult = { id: string };
