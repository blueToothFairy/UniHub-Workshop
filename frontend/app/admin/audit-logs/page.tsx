import type { ReactElement } from "react";
import { adminApi } from "@/lib/api";
import { getAccessTokenFromCookie } from "@/lib/auth";

export default async function AdminAuditLogsPage(): Promise<ReactElement> {
  const token: string = await getAccessTokenFromCookie();
  if (!token) {
    return <p>Missing access token cookie.</p>;
  }

  const logs = await adminApi.getAuditLogs(token);

  return (
    <section className="grid">
      <h1>Audit logs</h1>
      <div className="card table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.createdAt).toLocaleString("vi-VN")}</td>
                <td>{log.action}</td>
                <td>{log.actorUserId}</td>
                <td>{log.targetId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
