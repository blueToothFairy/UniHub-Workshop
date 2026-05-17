"use client";

import { useState, type ReactElement } from "react";
import { adminApi } from "@/lib/api";
import type { AuditLogListItem, AuditLogListResponse } from "@/types/admin";

interface Props {
  token: string;
  initialPage: AuditLogListResponse;
}

export default function AuditLogsPanel({ token, initialPage }: Props): ReactElement {
  const [items, setItems] = useState<AuditLogListItem[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.next_cursor);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore(): Promise<void> {
    if (!nextCursor || loading) return;

    setLoading(true);
    setError(null);
    try {
      const page = await adminApi.getAuditLogs(token, { cursor: nextCursor });
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        const appended = page.items.filter((item) => !seen.has(item.id));
        return [...current, ...appended];
      });
      setNextCursor(page.next_cursor);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load more audit logs");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
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
            {items.map((log) => (
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

      {items.length === 0 ? <p className="muted">No audit logs yet.</p> : null}
      {error ? <p className="notification-error">{error}</p> : null}
      {nextCursor ? (
        <button className="btn btn-secondary" type="button" disabled={loading} onClick={() => void loadMore()}>
          {loading ? "Loading..." : "Load more"}
        </button>
      ) : null}
    </>
  );
}
