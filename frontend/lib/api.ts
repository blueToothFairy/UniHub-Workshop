import type {
  AuditLog,
  CreateWorkshopInput,
  DashboardStats,
  UpdateWorkshopInput,
  Workshop
} from "@/types/admin";

const API_BASE_URL: string = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
const ACCESS_TOKEN_TTL_SECONDS: number = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS: number = 7 * 24 * 60 * 60;

interface ApiErrorBody {
  error: { code: string; message: string };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const err = body as ApiErrorBody;
    throw new Error(`${err.error?.code ?? "API_ERROR"}: ${err.error?.message ?? "Request failed"}`);
  }
  return (body as { data: T }).data;
}

function readCookie(name: string): string {
  if (typeof document === "undefined") {
    return "";
  }

  const parts: string[] = document.cookie.split(";").map((item) => item.trim());
  for (const part of parts) {
    if (!part) {
      continue;
    }
    const index: number = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key: string = part.slice(0, index);
    if (key === name) {
      return decodeURIComponent(part.slice(index + 1));
    }
  }

  return "";
}

function clearAuthCookies(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = "access_token=; path=/; max-age=0; samesite=lax";
  document.cookie = "refresh_token=; path=/; max-age=0; samesite=lax";
}

async function attemptRefresh(): Promise<string | null> {
  // single-flight: ensure only one refresh runs at a time across concurrent calls
  if ((attemptRefresh as any)._inFlight) {
    return (attemptRefresh as any)._inFlight as Promise<string | null>;
  }

  (attemptRefresh as any)._inFlight = (async () => {
    try {
      const refreshToken: string = readCookie("refresh_token");
      if (!refreshToken) {
        clearAuthCookies();
        return null;
      }

      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      if (!res.ok) {
        // clear cookies on failure so subsequent requests fail fast
        clearAuthCookies();
        return null;
      }

      const body: unknown = await res.json().catch(() => ({}));
      const access = (body as any).access_token as string | undefined;
      const refresh = (body as any).refresh_token as string | undefined;
      if (!access) return null;
      if (typeof document !== "undefined") {
        // update cookies
        document.cookie = `access_token=${encodeURIComponent(access)}; path=/; max-age=${ACCESS_TOKEN_TTL_SECONDS}; samesite=lax`;
        if (refresh) {
          document.cookie = `refresh_token=${encodeURIComponent(refresh)}; path=/; max-age=${REFRESH_TOKEN_TTL_SECONDS}; samesite=lax`;
        }
      }
      return access;
    } catch {
      clearAuthCookies();
      return null;
    } finally {
      // clear in-flight marker
      delete (attemptRefresh as any)._inFlight;
    }
  })();

  return (attemptRefresh as any)._inFlight as Promise<string | null>;
}

export async function apiGet<T>(path: string, token: string): Promise<T> {
  const response: Response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    credentials: "include"
  });

  if (response.ok) return parseResponse<T>(response);

  // try refresh on token expiry and retry once
  const body = await response.json().catch(() => ({}));
  if ((body as any).error?.code === "TOKEN_EXPIRED") {
    const newToken = await attemptRefresh();
    if (!newToken) throw new Error(`${(body as any).error.code}: ${(body as any).error.message}`);
    const retry = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${newToken}` },
      cache: "no-store",
      credentials: "include"
    });
    return parseResponse<T>(retry);
  }

  throw new Error(`${(body as any).error?.code ?? "API_ERROR"}: ${(body as any).error?.message ?? "Request failed"}`);
}

export async function apiPost<T>(path: string, token: string, payload: unknown): Promise<T> {
  const response: Response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    credentials: "include"
  });

  if (response.ok) return parseResponse<T>(response);

  const body = await response.json().catch(() => ({}));
  if ((body as any).error?.code === "TOKEN_EXPIRED") {
    const newToken = await attemptRefresh();
    if (!newToken) throw new Error(`${(body as any).error.code}: ${(body as any).error.message}`);
    const retry = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${newToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "include"
    });
    return parseResponse<T>(retry);
  }

  throw new Error(`${(body as any).error?.code ?? "API_ERROR"}: ${(body as any).error?.message ?? "Request failed"}`);
}

export async function apiPut<T>(path: string, token: string, payload: unknown): Promise<T> {
  const response: Response = await fetch(`${API_BASE_URL}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    credentials: "include"
  });

  if (response.ok) return parseResponse<T>(response);

  const body = await response.json().catch(() => ({}));
  if ((body as any).error?.code === "TOKEN_EXPIRED") {
    const newToken = await attemptRefresh();
    if (!newToken) throw new Error(`${(body as any).error.code}: ${(body as any).error.message}`);
    const retry = await fetch(`${API_BASE_URL}${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${newToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "include"
    });
    return parseResponse<T>(retry);
  }

  throw new Error(`${(body as any).error?.code ?? "API_ERROR"}: ${(body as any).error?.message ?? "Request failed"}`);
}

export const adminApi = {
  getStats: (token: string): Promise<DashboardStats> => apiGet<DashboardStats>("/admin/dashboard/stats", token),
  getWorkshops: (token: string): Promise<Workshop[]> => apiGet<Workshop[]>("/admin/workshops", token),
  getAuditLogs: (token: string): Promise<AuditLog[]> => apiGet<AuditLog[]>("/admin/audit-logs", token),
  createWorkshop: (token: string, payload: CreateWorkshopInput): Promise<Workshop> =>
    apiPost<Workshop>("/admin/workshops", token, payload),
  updateWorkshop: (token: string, id: string, payload: UpdateWorkshopInput): Promise<Workshop> =>
    apiPut<Workshop>(`/admin/workshops/${id}`, token, payload),
  cancelWorkshop: (token: string, id: string): Promise<Workshop> => apiPost<Workshop>(`/admin/workshops/${id}/cancel`, token, {})
};
