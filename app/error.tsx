"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="content-page">
      <h1>No se pudo abrir esta vista.</h1>
      <p className="page-subtitle">
        Vuelve a intentarlo. Tus archivos temporales mantienen su fecha de
        caducidad.
      </p>
      <button className="button primary" onClick={reset}>
        Reintentar
      </button>
    </div>
  );
}
