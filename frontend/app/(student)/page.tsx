import Link from "next/link";
import type { ReactElement } from "react";

export default function StudentHomePage(): ReactElement {
  return (
    <main>
      <section className="section">
        <div className="container grid" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
          <div>
            <h1 style={{ fontSize: 40, margin: 0 }}>Discover workshops that match your goals</h1>
            <p className="muted">Track schedules, register quickly, and get timely updates from UniHub.</p>
            <div style={{ display: "flex", gap: 12 }}>
              <Link href="/login" className="btn btn-primary">Get started</Link>
              <Link href="/admin" className="btn btn-secondary">Go to admin area</Link>
            </div>
          </div>
          <div className="card" style={{ boxShadow: "var(--shadow-soft)" }}>
            <p className="muted" style={{ marginTop: 0 }}>Highlights</p>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <article className="card"><strong>24+</strong><p className="muted">Workshops</p></article>
              <article className="card"><strong>3,000+</strong><p className="muted">Registrations</p></article>
            </div>
          </div>
        </div>
      </section>

      <footer className="footer-band">
        <div className="container footer-grid">
          <div>
            <h3 style={{ marginTop: 0 }}>UniHub Workshop</h3>
            <p>A practical learning space designed for students.</p>
          </div>
          <div>
            <h4>Navigation</h4>
            <p><Link href="/">Home</Link></p>
            <p><Link href="/login">Log in</Link></p>
          </div>
          <div>
            <h4>Contact</h4>
            <p>Email: support@unihub.local</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
