import Link from "next/link";
import type { ReactElement } from "react";
import { getWorkshopsThisMonth } from "@/lib/api";

export default async function StudentHomePage(): Promise<ReactElement> {
  const payload = await getWorkshopsThisMonth();
  const workshops = payload.workshops ?? [];
  const stats = payload.stats ?? { workshopsThisMonth: 0, registrationsThisMonth: 0 };

  function formatDateLabel(at?: string): string {
    if (!at) return "Date unavailable";
    try {
      return new Date(at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "2-digit", year: "numeric" });
    } catch {
      return at;
    }
  }

  function formatTimeLabel(at?: string): string {
    if (!at) return "Time TBD";
    try {
      return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch {
      return at;
    }
  }

  return (
    <main>
      <section className="section">
        <div className="container hero-grid">
          <div>
            <h1 className="hero-title">Discover workshops that match your goals</h1>
            <p className="muted">Track schedules, register quickly, and get timely updates from UniHub.</p>
            <div className="hero-actions">
              <Link href="/login" className="btn btn-primary">Get started</Link>
              <Link href="/admin" className="btn btn-secondary">Go to admin area</Link>
            </div>
          </div>
          <div className="card highlight-panel">
            <p className="muted" style={{ marginTop: 0 }}>Highlights</p>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <article className="stat-tile"><p className="stat-metric">{stats.workshopsThisMonth}</p><p className="muted">Workshops this month</p></article>
              <article className="stat-tile"><p className="stat-metric">{stats.registrationsThisMonth}</p><p className="muted">Registrations</p></article>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Available Workshops</h2>
          <p className="muted">Explore our upcoming sessions this month. Click a workshop to view details.</p>
          <div className="card-grid workshop-showcase-grid">
            {workshops.map((w) => (
              <article key={w.id} className="workshop-showcase-card">
                <p className="workshop-showcase-date">{formatDateLabel(w.startsAt)}</p>
                <h3 className="workshop-showcase-title">{w.title}</h3>
                <div className="workshop-showcase-meta">
                  <p><strong>Time:</strong> {formatTimeLabel(w.startsAt)}</p>
                  <p><strong>Speaker:</strong> {w.speakerName}</p>
                  <p><strong>Room:</strong> {w.room}</p>
                </div>
                <div className="workshop-showcase-footer">
                  <p className="workshop-seat-availability">{w.availableSeats} seats available</p>
                  <Link href={`/workshops/${w.id}`} className="workshop-showcase-link">View details</Link>
                </div>
              </article>
            ))}
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
