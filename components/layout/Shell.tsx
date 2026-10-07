"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AudioLines,
  FolderOpen,
  SlidersHorizontal,
  CreditCard,
  Shield,
  ArrowUpRight,
  CircleHelp,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const links = [
    { href: "/studio", label: "Estudio local", icon: SlidersHorizontal },
    { href: "/dashboard/projects", label: "Mis proyectos", icon: FolderOpen },
    { href: "/pricing", label: "Planes y consumo", icon: CreditCard },
    { href: "/features", label: "Cómo funciona", icon: CircleHelp },
  ];
  return (
    <div className="app-shell">
      <button
        className="mobile-menu icon-button"
        aria-label="Abrir navegación"
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      <aside className={`sidebar ${open ? "is-open" : ""}`}>
        <Link href="/" className="brand">
          <span className="brand-symbol">
            <AudioLines size={25} />
          </span>
          <span>
            AudioScore<span className="brand-ai">AI</span>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-avatar">A</span>
          <div>
            Mi espacio musical<small>Audio · MIDI · Partituras</small>
          </div>
          <span className="tiny-dot" />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {links.map((l) => (
            <Link
              onClick={() => setOpen(false)}
              key={l.href}
              href={l.href}
              className={`nav-item ${path.startsWith(l.href) ? "active" : ""}`}
            >
              <l.icon size={18} />
              {l.label}
              {path.startsWith(l.href) && <span className="active-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-tip">
          <span className="tip-icon">
            <Activity size={19} />
          </span>
          <strong>De la escucha a la escritura.</strong>
          <p>
            Trabaja con tu audio, revisa cada nota y dale forma a tu música.
          </p>
          <Link href="/features">
            Explorar herramientas <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="sidebar-bottom">
          <Link href="/admin" className="nav-item">
            <Shield size={17} />
            Administración
          </Link>
          <Link href="/auth/login" className="profile">
            <span className="workspace-avatar">♪</span>
            <div>
              Tu cuenta<small>Iniciar sesión</small>
            </div>
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <span>
            WORKSPACE{" "}
            <span className="breadcrumb">
              /{" "}
              {path.includes("pricing")
                ? "Planes"
                : path.includes("dashboard")
                  ? "Proyectos"
                  : path.includes("features")
                    ? "Herramientas"
                    : "Estudio"}
            </span>
          </span>
          <div>
            <span className="local-badge">
              <span />
              Archivos temporales
            </span>
            <Link className="top-link" href="/auth/login">
              Conectar cuenta <ArrowUpRight size={14} />
            </Link>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
