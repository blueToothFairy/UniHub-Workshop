"use client";

import { notificationApi, type NotificationInboxItem } from "@/lib/api";
import { useEffect, useState } from "react";

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const parts = document.cookie.split(";").map((item) => item.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx) === name) return decodeURIComponent(part.slice(idx + 1));
  }
  return "";
}

function isOfflineClientState(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("failed to fetch") || message.includes("networkerror");
}

export function NotificationInboxPanel(): JSX.Element {
  const [items, setItems] = useState<NotificationInboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [markingId, setMarkingId] = useState<string>("");

  async function loadNotifications(): Promise<void> {
    const token = readCookie("access_token");
    if (!token) {
      setLoading(false);
      setItems([]);
      setUnreadCount(0);
      setError("");
      return;
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("You are offline. Reconnect and retry to load notifications.");
      setLoading(false);
      return;
    }

    try {
      const [list, unread] = await Promise.all([
        notificationApi.listNotifications(token, { limit: 8 }),
        notificationApi.getUnreadCount(token)
      ]);
      setItems(list.items);
      setUnreadCount(unread.unread_count);
      setError("");
    } catch (err: unknown) {
      if (isOfflineClientState(err)) {
        setError("You are offline. Reconnect and retry to load notifications.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to load notifications");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleMarkRead(id: string): Promise<void> {
    const token = readCookie("access_token");
    if (!token) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("You are offline. Reconnect and retry this action.");
      return;
    }

    setMarkingId(id);
    try {
      await notificationApi.markRead(token, id);
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, is_read: true } : item)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      setError("");
    } catch (err: unknown) {
      if (isOfflineClientState(err)) {
        setError("You are offline. Reconnect and retry this action.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to mark notification as read");
      }
    } finally {
      setMarkingId("");
    }
  }

  useEffect(() => {
    void loadNotifications();
  }, []);

  return (
    <article className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Notifications</h3>
        <span className={`status-pill ${unreadCount > 0 ? "status-pending" : "status-fallback"}`}>
          {unreadCount} unread
        </span>
      </div>
      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <button
          className="btn btn-secondary"
          disabled={loading || refreshing}
          onClick={() => {
            setRefreshing(true);
            void loadNotifications();
          }}
        >
          {refreshing ? "Refreshing..." : "Refresh inbox"}
        </button>
      </div>

      {loading ? <p>Loading notifications...</p> : null}
      {!loading && items.length === 0 ? <p className="muted">No notifications yet.</p> : null}

      <div className="grid">
        {items.map((item) => (
          <article key={item.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700 }}>{item.title}</p>
                <p className="muted" style={{ marginTop: 6, marginBottom: 6 }}>{new Date(item.created_at).toLocaleString()}</p>
              </div>
              <span className={`status-pill ${item.is_read ? "status-success" : "status-pending"}`}>
                {item.is_read ? "Read" : "Unread"}
              </span>
            </div>
            <p style={{ marginTop: 8 }}>{item.body}</p>
            {!item.is_read ? (
              <button className="btn" disabled={markingId === item.id} onClick={() => void handleMarkRead(item.id)}>
                {markingId === item.id ? "Updating..." : "Mark as read"}
              </button>
            ) : null}
          </article>
        ))}
      </div>

      {error ? <p style={{ color: "var(--color-danger)" }}>{error}</p> : null}
    </article>
  );
}

