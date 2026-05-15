import Link from "next/link";
import type { ReactElement } from "react";
import { getWorkshopsThisMonth } from "@/lib/api";
import WorkshopDiscoveryPanel from "@/components/student/workshop-discovery-panel";
import { DEFAULT_WORKSHOP_DISCOVERY_QUERY, isWorkshopDiscoveryPaymentFilter } from "@/lib/workshop-discovery";
import type { WorkshopDiscoveryQuery } from "@/types/admin";

interface Props {
  searchParams?: {
    q?: string;
    payment?: string;
    available_only?: string;
  };
}

export default async function StudentHomePage({ searchParams }: Props): Promise<ReactElement> {
  const paymentParam = searchParams?.payment ?? "";
  const payment: WorkshopDiscoveryQuery["payment"] = isWorkshopDiscoveryPaymentFilter(paymentParam)
    ? paymentParam
    : DEFAULT_WORKSHOP_DISCOVERY_QUERY.payment;
  const initialQuery: Partial<WorkshopDiscoveryQuery> = {
    q: searchParams?.q ?? DEFAULT_WORKSHOP_DISCOVERY_QUERY.q,
    payment,
    availableOnly: searchParams?.available_only === "true"
  };
  const payload = await getWorkshopsThisMonth(initialQuery);
  const stats = payload.stats ?? { workshopsThisMonth: 0, registrationsThisMonth: 0 };

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
          <p className="muted">Search, filter, and explore our upcoming sessions this month. Click a workshop to view details.</p>
          <WorkshopDiscoveryPanel initialPayload={payload} initialQuery={initialQuery} />
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
