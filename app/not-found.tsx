import Link from "next/link";
export default function NotFound() {
  return (
    <div className="content-page">
      <h1>No encontramos esta página.</h1>
      <p className="page-subtitle">
        Vuelve al estudio para seguir trabajando con tu música.
      </p>
      <Link className="button primary" href="/studio">
        Abrir estudio
      </Link>
    </div>
  );
}
