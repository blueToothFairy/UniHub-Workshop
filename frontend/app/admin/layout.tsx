import Link from "next/link";
import type { ReactElement, ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>UniHub Admin</h2>
        <p className="muted" style={{ marginTop: 0 }}>Workshop operations center</p>
        <nav aria-label="Admin Navigation" className="grid">
          <Link className="admin-nav-link" href="/admin/dashboard">Dashboard</Link>
          <Link className="admin-nav-link" href="/admin/workshops">Workshops</Link>
          <Link className="admin-nav-link" href="/admin/audit-logs">Audit logs</Link>
        </nav>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}

