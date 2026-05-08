"use client";

import { useEffect, useState, type ReactElement } from "react";
import { adminApi } from "@/lib/api";
import type { DashboardStats } from "@/types/admin";

interface Props {
  token: string;
  initialStats: DashboardStats;
}

export default function DashboardStatsPanel({ token, initialStats }: Props): ReactElement {
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [isStale, setIsStale] = useState<boolean>(false);

  useEffect(() => {
    const interval: ReturnType<typeof setInterval> = setInterval(async () => {
      try {
        const next: DashboardStats = await adminApi.getStats(token);
        setStats(next);
        setIsStale(false);
      } catch {
        setIsStale(true);
      }
    }, 7000);

    return () => clearInterval(interval);
  }, [token]);

  return (
    <section className="grid">
      <h1>Dashboard</h1>
      <p className="muted">Last updated: {new Date(stats.lastUpdatedAt).toLocaleString("vi-VN")}</p>
      {isStale ? <p style={{ color: "#b45309" }}>Data is stale. Auto-refresh will retry.</p> : null}
      <div className="stat-grid">
        <article className="card"><p className="muted">Total workshops</p><p className="stat-metric">{stats.totalWorkshops}</p></article>
        <article className="card"><p className="muted">Total registrations</p><p className="stat-metric">{stats.totalRegistrations}</p></article>
        <article className="card"><p className="muted">Paid workshops</p><p className="stat-metric">{stats.paidWorkshops}</p></article>
        <article className="card"><p className="muted">Free workshops</p><p className="stat-metric">{stats.freeWorkshops}</p></article>
        <article className="card"><p className="muted">Cancelled workshops</p><p className="stat-metric">{stats.cancelledWorkshops}</p></article>
        <article className="card"><p className="muted">Check-ins</p><p className="stat-metric">{stats.checkins}</p></article>
      </div>
    </section>
  );
}

