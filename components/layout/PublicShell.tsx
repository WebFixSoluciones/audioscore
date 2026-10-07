import Link from "next/link";
import { AudioLines, ArrowUpRight } from "lucide-react";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-site">
      <header className="public-header">
        <Link href="/" className="brand" aria-label="AudioScore, inicio">
          <span className="brand-symbol">
            <AudioLines size={25} />
          </span>
          <span>
            AudioScore<span className="brand-ai">AI</span>
          </span>
        </Link>
        <nav aria-label="Navegación pública">
          <Link href="/features">Herramientas</Link>
          <Link href="/pricing">Planes</Link>
          <Link href="/auth/login" className="button primary">
            Ingresar <ArrowUpRight size={15} />
          </Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="public-footer">
        AudioScore AI · Tu audio, tus notas, tu música.
      </footer>
    </div>
  );
}
