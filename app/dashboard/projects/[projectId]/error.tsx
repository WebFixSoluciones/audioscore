"use client";
export default function ProjectError({ reset }: { reset: () => void }) {
  return (
    <div className="content-page">
      <h1>No pudimos abrir este proyecto.</h1>
      <p className="page-subtitle">
        Comprueba tu acceso y vuelve a intentarlo.
      </p>
      <button className="button secondary" onClick={reset}>
        Reintentar
      </button>
    </div>
  );
}
