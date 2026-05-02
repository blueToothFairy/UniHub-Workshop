import type { ReactElement } from "react";
import { adminApi } from "@/lib/api";
import { getAccessTokenFromCookie } from "@/lib/auth";
import DashboardStatsPanel from "@/components/admin/dashboard-stats-panel";

export default async function AdminDashboardPage(): Promise<ReactElement> {
  const token: string = await getAccessTokenFromCookie();
  if (!token) {
    return <p>Missing access token cookie.</p>;
  }

  const stats = await adminApi.getStats(token);
  return <DashboardStatsPanel token={token} initialStats={stats} />;
}

