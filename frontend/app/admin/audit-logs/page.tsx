import type { ReactElement } from "react";
import AuditLogsPanel from "@/components/admin/audit-logs-panel";
import { adminApi } from "@/lib/api";
import { getAccessTokenFromCookie } from "@/lib/auth";

export default async function AdminAuditLogsPage(): Promise<ReactElement> {
  const token: string = await getAccessTokenFromCookie();
  if (!token) {
    return <p>Missing access token cookie.</p>;
  }

  const initialPage = await adminApi.getAuditLogs(token, { limit: 25 });

  return (
    <section className="grid">
      <h1>Audit logs</h1>
      <AuditLogsPanel token={token} initialPage={initialPage} />
    </section>
  );
}
