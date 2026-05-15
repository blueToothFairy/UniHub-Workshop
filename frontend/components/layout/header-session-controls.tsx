"use client";

import { logout } from "@/lib/auth-api";
import { notificationApi, type NotificationInboxItem } from "@/lib/api";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactElement } from "react";

interface HeaderSessionControlsProps {
  initialAuthenticated: boolean;
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const parts = document.cookie.split(";").map((item) => item.trim());
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index) === name) return decodeURIComponent(part.slice(index + 1));
  }
  return "";
}

function hasAuthCookies(): boolean {
  return Boolean(readCookie("access_token") || readCookie("refresh_token"));
}

function clearAuthCookies(): void {
  if (typeof document === "undefined") return;
  document.cookie = "access_token=; path=/; max-age=0; samesite=lax";
  document.cookie = "refresh_token=; path=/; max-age=0; samesite=lax";
  document.cookie = "role=; path=/; max-age=0; samesite=lax";
}

function isOfflineClientState(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("failed to fetch") || message.includes("networkerror");
}

export function HeaderSessionControls({ initialAuthenticated }: HeaderSessionControlsProps): ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(initialAuthenticated);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [loggingOut, setLoggingOut] = useState<boolean>(false);
  const [items, setItems] = useState<NotificationInboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const [markingId, setMarkingId] = useState<string>("");

  async function loadNotifications(): Promise<void> {
    const token = readCookie("access_token");
    if (!token) {
      setItems([]);
      setUnreadCount(0);
      setError("");
      return;
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("You are offline. Reconnect and retry to load notifications.");
      return;
    }

    setLoading(true);
    try {
      const [list, unread] = await Promise.all([
        notificationApi.listNotifications(token, { limit: 24 }),
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

  async function handleLogout(): Promise<void> {
    if (loggingOut) return;
    setLoggingOut(true);
    const accessToken = readCookie("access_token");
    const refreshToken = readCookie("refresh_token");

    try {
      if (refreshToken) {
        await logout(accessToken, refreshToken);
      }
    } catch {
      // Best-effort revoke: client cookies are still cleared below.
    } finally {
      clearAuthCookies();
      setIsAuthenticated(false);
      setIsOpen(false);
      setItems([]);
      setUnreadCount(0);
      setError("");
      setLoggingOut(false);
      router.push("/");
      router.refresh();
    }
  }

  useEffect(() => {
    const nextAuthenticated = hasAuthCookies();
    setIsAuthenticated(nextAuthenticated);
    if (!nextAuthenticated) {
      setIsOpen(false);
      setItems([]);
      setUnreadCount(0);
    }
  }, [pathname]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadNotifications();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !isOpen) return;
    void loadNotifications();
  }, [isAuthenticated, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleDocumentClick = (event: MouseEvent): void => {
      if (!popoverRef.current) return;
      const target = event.target;
      if (target instanceof Node && !popoverRef.current.contains(target)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  if (!isAuthenticated) {
    return (
      <>
        <Link href="/register" className="btn btn-secondary">Sign up</Link>
        <Link href="/login" className="btn btn-primary">Log in</Link>
      </>
    );
  }

  return (
    <div className="session-controls">
      <div className="notification-popover" ref={popoverRef}>
        <button
          type="button"
          className="notification-trigger"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label="Open notifications"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
        >
          <span className="notification-bell" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img" focusable="false">
              <path d="M15.2 17H5.9c-.8 0-1.3-.9-.8-1.6l1.3-2.1c.4-.6.6-1.3.6-2.1V9a5.8 5.8 0 1 1 11.6 0v2.2c0 .8.2 1.5.6 2.1l1.3 2.1c.5.7 0 1.6-.8 1.6h-4.5Z" />
              <path d="M10 17a2 2 0 0 0 4 0" />
            </svg>
          </span>
          {unreadCount > 0 ? <span className="notification-counter">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
        </button>

        {isOpen ? (
          <section className="notification-menu" role="dialog" aria-label="Notification inbox">
            <header className="notification-menu-header">
              <h3>Notifications</h3>
              <button type="button" className="notification-refresh" disabled={loading} onClick={() => void loadNotifications()}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </header>

            <p className="notification-meta">Unread now: <strong>{unreadCount}</strong></p>
            {loading ? <p className="notification-meta">Loading notifications...</p> : null}
            {!loading && items.length === 0 ? <p className="notification-meta">No notifications yet.</p> : null}

            <div className="notification-scroll">
              {items.map((item) => (
                <article
                  key={item.id}
                  className={`notification-item ${item.is_read ? "is-read" : "is-unread"}`}
                  aria-live={item.is_read ? undefined : "polite"}
                >
                  <div className="notification-item-top">
                    <p className="notification-title">{item.title}</p>
                    <span className={`notification-state-tag ${item.is_read ? "is-read" : "is-unread"}`}>
                      {item.is_read ? "Read" : "New"}
                    </span>
                  </div>
                  <p className="notification-date">{new Date(item.created_at).toLocaleString()}</p>
                  <p className="notification-body">{item.body}</p>
                  {!item.is_read ? (
                    <button
                      type="button"
                      className="notification-mark-read"
                      disabled={markingId === item.id}
                      onClick={() => void handleMarkRead(item.id)}
                    >
                      {markingId === item.id ? "Updating..." : "Mark as read"}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>

            {error ? <p className="notification-error">{error}</p> : null}
          </section>
        ) : null}
      </div>

      <button type="button" className="btn btn-secondary" onClick={() => void handleLogout()} disabled={loggingOut}>
        {loggingOut ? "Logging out..." : "Logout"}
      </button>
    </div>
  );
}
