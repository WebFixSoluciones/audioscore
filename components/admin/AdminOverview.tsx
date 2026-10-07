import Link from "next/link";
export function AdminOverview() {
  return (
    <>
      <h2>Control de usuarios y planes</h2>
      <p className="page-subtitle">
        Los cambios se aplican en el servidor y quedan registrados en el
        historial administrativo.
      </p>
      <div className="dashboard-grid">
        <Link href="/admin/users" className="detail-card dashboard-card">
          <h3>Usuarios registrados</h3>
          <p>
            Consulta cuentas, asigna planes y suspende o reactiva el acceso.
          </p>
          <span>Administrar usuarios →</span>
        </Link>
        <Link href="/admin/plans" className="detail-card dashboard-card">
          <h3>Planes y límites</h3>
          <p>
            Edita precios, minutos, proyectos, exportaciones y funciones
            incluidas.
          </p>
          <span>Administrar planes →</span>
        </Link>
        <Link href="/admin/logs" className="detail-card dashboard-card">
          <h3>Historial de cambios</h3>
          <p>Consulta las operaciones realizadas por los administradores.</p>
          <span>Ver historial →</span>
        </Link>
      </div>
      <p className="notice">
        Las integraciones con Lyria y otras IA se definirán en una siguiente
        etapa. La asignación de planes de pago es manual; todavía no hay cobros
        automáticos.
      </p>
    </>
  );
}
