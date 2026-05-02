import type { ReactElement } from "react";

export default function ForbiddenPage(): ReactElement {
  return (
    <main className="section">
      <div className="container card">
        <h1>403 Forbidden</h1>
        <p className="muted">You do not have permission to access admin pages.</p>
      </div>
    </main>
  );
}

