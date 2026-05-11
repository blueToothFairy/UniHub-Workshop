import type {
  AuditLog,
  CreateWorkshopInput,
  DashboardStats,
  UpdateWorkshopInput,
  UploadWorkshopPdfResponse,
  Workshop
} from "@/types/admin";

const API_BASE_URL: string = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
const ACCESS_TOKEN_TTL_SECONDS: number = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS: number = 7 * 24 * 60 * 60;

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface ApiTemporaryUnavailableBody {
  error: string;
  message: string;
  retry_after: number;
}

export class ApiRequestError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly retryAfterSeconds?: number;

  public constructor(input: { code: string; message: string; statusCode: number; retryAfterSeconds?: number }) {
    super(`${input.code}: ${input.message}`);
    this.code = input.code;
    this.statusCode = input.statusCode;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

export interface CreateRegistrationResultFree {
  registration_id: string;
  registration_status: "confirmed";
  payment_required: false;
  qr_available: true;
}

export interface CreateRegistrationResultPaid {
  registration_id: string;
  registration_status: "pending_payment";
  payment_required: true;
  payment_id: string;
  payment_status: "pending_provider" | "unknown";
  payment_url: string | null;
  next_action: "redirect_to_payment";
}

export type CreateRegistrationResult = CreateRegistrationResultFree | CreateRegistrationResultPaid;

export interface RegistrationPaymentStatus {
  registration_id: string;
  registration_status: "pending_payment" | "confirmed" | "expired" | "cancelled";
  payment_status: "pending_provider" | "unknown" | "completed" | "expired" | "failed" | "requires_review";
  payment_url?: string | null;
  next_action?: "redirect_to_payment" | "wait_for_confirmation" | "register_again" | "contact_support";
  qr_available?: true;
}

export interface RegistrationQrData {
  registration_id: string;
  qr_token: string;
  qr_issued_at: string;
}

export interface CurrentRegistrationData {
  registration_id: string;
  workshop_id: string;
  registration_status: "pending_payment" | "confirmed";
  payment_status: "pending_provider" | "unknown" | "completed";
  payment_url: string | null;
  qr_available: boolean;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    throw toApiRequestError(response.status, body);
  }
  return (body as { data: T }).data;
}

function toApiRequestError(statusCode: number, body: unknown): ApiRequestError {
  const wrapped = body as ApiErrorBody;
  if (wrapped?.error && typeof wrapped.error !== "string") {
    return new ApiRequestError({
      code: wrapped.error.code ?? "API_ERROR",
      message: wrapped.error.message ?? "Request failed",
      statusCode
    });
  }

  const flat = body as ApiTemporaryUnavailableBody;
  return new ApiRequestError({
    code: typeof flat?.error === "string" ? flat.error : "API_ERROR",
    message: typeof flat?.message === "string" ? flat.message : "Request failed",
    statusCode,
    retryAfterSeconds: typeof flat?.retry_after === "number" ? flat.retry_after : undefined
  });
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const parts: string[] = document.cookie.split(";").map((item) => item.trim());
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index) === name) return decodeURIComponent(part.slice(index + 1));
  }
  return "";
}

function clearAuthCookies(): void {
  if (typeof document === "undefined") return;
  document.cookie = "access_token=; path=/; max-age=0; samesite=lax";
  document.cookie = "refresh_token=; path=/; max-age=0; samesite=lax";
}

async function attemptRefresh(): Promise<string | null> {
  if ((attemptRefresh as unknown as { _inFlight?: Promise<string | null> })._inFlight) {
    return (attemptRefresh as unknown as { _inFlight: Promise<string | null> })._inFlight;
  }

  (attemptRefresh as unknown as { _inFlight: Promise<string | null> })._inFlight = (async () => {
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
        clearAuthCookies();
        return null;
      }

      const body: unknown = await res.json().catch(() => ({}));
      const access = (body as { access_token?: string }).access_token;
      const refresh = (body as { refresh_token?: string }).refresh_token;
      if (!access) return null;

      if (typeof document !== "undefined") {
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
      delete (attemptRefresh as unknown as { _inFlight?: Promise<string | null> })._inFlight;
    }
  })();

  return (attemptRefresh as unknown as { _inFlight: Promise<string | null> })._inFlight;
}

async function withRefreshRetry<T>(request: () => Promise<Response>): Promise<T> {
  const response = await request();
  if (response.ok) return parseResponse<T>(response);

  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (body.error?.code === "TOKEN_EXPIRED") {
    const newToken = await attemptRefresh();
    if (!newToken) {
      throw new ApiRequestError({
        code: body.error.code,
        message: body.error.message ?? "Token expired",
        statusCode: response.status
      });
    }
    return withRefreshRetry<T>(request);
  }
  throw toApiRequestError(response.status, body);
}

export async function apiGet<T>(path: string, token: string): Promise<T> {
  return withRefreshRetry<T>(() =>
    fetch(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      credentials: "include"
    })
  );
}

export async function apiPost<T>(path: string, token: string, payload: unknown): Promise<T> {
  return withRefreshRetry<T>(() =>
    fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "include"
    })
  );
}

export async function apiPostWithHeaders<T>(path: string, token: string, payload: unknown, headers: Record<string, string>): Promise<T> {
  return withRefreshRetry<T>(() =>
    fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "include"
    })
  );
}

export async function apiPostMultipart<T>(path: string, token: string, formData: FormData): Promise<T> {
  return withRefreshRetry<T>(() =>
    fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
      cache: "no-store",
      credentials: "include"
    })
  );
}

export async function apiPut<T>(path: string, token: string, payload: unknown): Promise<T> {
  return withRefreshRetry<T>(() =>
    fetch(`${API_BASE_URL}${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "include"
    })
  );
}

export async function apiPutNoContent(path: string, token: string, payload: unknown): Promise<void> {
  await withRefreshRetry<unknown>(() =>
    fetch(`${API_BASE_URL}${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "include"
    })
  );
}

export const adminApi = {
  getStats: (token: string): Promise<DashboardStats> => apiGet<DashboardStats>("/admin/dashboard/stats", token),
  getWorkshops: (token: string): Promise<Workshop[]> => apiGet<Workshop[]>("/admin/workshops", token),
  getWorkshop: (token: string, id: string): Promise<Workshop> => apiGet<Workshop>(`/admin/workshops/${id}`, token),
  getAuditLogs: (token: string): Promise<AuditLog[]> => apiGet<AuditLog[]>("/admin/audit-logs", token),
  createWorkshop: (token: string, payload: CreateWorkshopInput): Promise<Workshop> =>
    apiPost<Workshop>("/admin/workshops", token, payload),
  updateWorkshop: (token: string, id: string, payload: UpdateWorkshopInput): Promise<Workshop> =>
    apiPut<Workshop>(`/admin/workshops/${id}`, token, payload),
  cancelWorkshop: (token: string, id: string): Promise<Workshop> => apiPost<Workshop>(`/admin/workshops/${id}/cancel`, token, {}),
  uploadWorkshopPdf: (token: string, id: string, file: File): Promise<UploadWorkshopPdfResponse> => {
    const formData = new FormData();
    formData.append("file", file);
    return apiPostMultipart<UploadWorkshopPdfResponse>(`/admin/workshops/${id}/pdf`, token, formData);
  },
  overrideSummary: (token: string, id: string, summary: string): Promise<void> =>
    apiPutNoContent(`/admin/workshops/${id}/summary`, token, { summary })
};

export const registrationApi = {
  createRegistration: (token: string, workshopId: string, idempotencyKey: string): Promise<CreateRegistrationResult> =>
    apiPostWithHeaders<CreateRegistrationResult>("/registrations", token, { workshop_id: workshopId }, { "Idempotency-Key": idempotencyKey }),
  getPaymentStatus: (token: string, registrationId: string): Promise<RegistrationPaymentStatus> =>
    apiGet<RegistrationPaymentStatus>(`/registrations/${registrationId}/payment-status`, token),
  getRegistrationQr: (token: string, registrationId: string): Promise<RegistrationQrData> =>
    apiGet<RegistrationQrData>(`/registrations/${registrationId}/qr`, token),
  getCurrentRegistrationByWorkshop: (token: string, workshopId: string): Promise<CurrentRegistrationData> =>
    apiGet<CurrentRegistrationData>(`/registrations/workshops/${workshopId}/current`, token)
};

export async function getWorkshopPublic(id: string): Promise<Workshop> {
  const response = await fetch(`${API_BASE_URL}/workshops/${id}`, { cache: "no-store" });
  return parseResponse<Workshop>(response);
}

export interface WorkshopsThisMonthResponse {
  stats: { workshopsThisMonth: number; registrationsThisMonth: number };
  workshops: Workshop[];
}

export async function getWorkshopsThisMonth(): Promise<WorkshopsThisMonthResponse> {
  const response = await fetch(`${API_BASE_URL}/workshops`, { cache: "no-store" });
  return parseResponse<WorkshopsThisMonthResponse>(response);
}
