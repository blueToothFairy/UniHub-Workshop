"use client";

import Link from "next/link";
import { useState } from "react";
import type { WorkshopsThisMonthResponse } from "@/lib/api";
import WorkshopShowcaseGrid from "@/components/student/workshop-showcase-grid";
import WorkshopDiscoveryControls from "@/components/student/workshop-discovery-controls";
import { useWorkshopDiscovery } from "@/components/student/use-workshop-discovery";
import type { WorkshopDiscoveryQuery } from "@/types/admin";

interface Props {
  initialPayload: WorkshopsThisMonthResponse;
  initialQuery?: Partial<WorkshopDiscoveryQuery>;
}

export default function StudentHomeExperience({ initialPayload, initialQuery }: Props): JSX.Element {
  const [payload, setPayload] = useState<WorkshopsThisMonthResponse>(initialPayload);
  const stats = payload.stats ?? { workshopsThisMonth: 0, registrationsThisMonth: 0 };
  const discovery = useWorkshopDiscovery({
    initialPayload,
    initialQuery,
    onPayloadChange: setPayload
  });

  return (
    <>
      <div className="home-intro-gradient">
        <section className="section home-intro-section">
          <div className="container hero-grid">
            <div>
              <h1 className="hero-title">Discover workshops that match your goals</h1>
              <p className="muted">Track schedules, register quickly, and get timely updates from UniHub.</p>
              <div className="hero-actions">
                <Link href="/login" className="btn btn-primary">Get started</Link>
              </div>
            </div>
            <div className="card highlight-panel">
              <p className="muted" style={{ marginTop: 0 }}>Highlights</p>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <article className="stat-tile">
                  <p className="stat-metric">{stats.workshopsThisMonth}</p>
                  <p className="muted">Workshops this month</p>
                </article>
                <article className="stat-tile">
                  <p className="stat-metric">{stats.registrationsThisMonth}</p>
                  <p className="muted">Registrations</p>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section className="section home-workshops-intro">
          <div className="container">
            <h2>Available Workshops</h2>
            <p className="muted">Search, filter, and explore our upcoming sessions this month. Click a workshop to view details.</p>
            <WorkshopDiscoveryControls discovery={discovery} suggestionWorkshops={initialPayload.workshops ?? []} />
          </div>
        </section>
      </div>

      <section className="section home-workshop-results">
        <div className="container">
          <div className={discovery.loading ? "workshop-showcase-grid-loading" : undefined}>
            <WorkshopShowcaseGrid workshops={discovery.workshops} />
          </div>
        </div>
      </section>
    </>
  );
}

