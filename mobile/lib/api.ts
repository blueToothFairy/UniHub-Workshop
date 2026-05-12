const API_BASE_URL: string = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;

  public constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface MobileAuthUser {
  id: string;
  email: string;
  full_name: string;
  role: "student" | "organizer" | "checkin_staff";
  force_change_password: boolean;
}

export interface MobileLoginRequest {
  email: string;
  password: string;
}

export interface MobileLoginResponse {
  access_token: string;
  refresh_token: string;
  user: MobileAuthUser;
  force_change_password: boolean;
}

export interface MobileRefreshResponse {
  access_token: string;
  refresh_token: string;
}

export interface MobileMeResponse {
  user: MobileAuthUser;
}

export type MobileCheckinScanResult = "checked_in" | "already_checked_in";
export type MobileCheckinSyncResult =
  | "checked_in"
  | "already_checked_in"
  | "invalid_qr"
  | "registration_not_confirmed"
  | "workshop_mismatch"
  | "workshop_cancelled";

export interface MobileCheckinScanRequest {
  qr_token: string;
  workshop_id?: string;
}

export interface MobileCheckinScanResponse {
  result: MobileCheckinScanResult;
  registration_id: string;
  workshop_id: string;
  checked_in_at: string;
}

export interface MobileCheckinSyncItemRequest {
  device_id: string;
  device_scan_id: string;
  qr_token: string;
  workshop_id?: string;
  scanned_at_device: string;
}

export interface MobileCheckinSyncItemResponse {
  device_scan_id: string;
  result: MobileCheckinSyncResult;
  registration_id: string | null;
  checked_in_at: string | null;
  error_code: string | null;
}

export interface MobileCheckinSyncResponse {
  results: MobileCheckinSyncItemResponse[];
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

async function readBody(response: Response): Promise<unknown> {
  const raw: string = await response.text();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function toApiError(response: Response, body: unknown): ApiError {
  const payload: ApiErrorBody = typeof body === "object" && body !== null ? (body as ApiErrorBody) : {};
  const code: string = payload.error?.code ?? "API_ERROR";
  const message: string = payload.error?.message ?? `Request failed with status ${response.status}`;
  return new ApiError(response.status, code, message);
}

async function parseRawResponse<T>(response: Response): Promise<T> {
  const body: unknown = await readBody(response);
  if (!response.ok) {
    throw toApiError(response, body);
  }
  return body as T;
}

async function parseDataEnvelope<T>(response: Response): Promise<T> {
  const body: unknown = await readBody(response);
  if (!response.ok) {
    throw toApiError(response, body);
  }

  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new ApiError(response.status, "INVALID_RESPONSE", "Response did not include a data envelope");
  }

  return (body as { data: T }).data;
}

async function requestRaw<T>(path: string, init: RequestInit): Promise<T> {
  const response: Response = await fetch(`${API_BASE_URL}${path}`, init);
  return parseRawResponse<T>(response);
}

async function requestData<T>(path: string, init: RequestInit): Promise<T> {
  const response: Response = await fetch(`${API_BASE_URL}${path}`, init);
  return parseDataEnvelope<T>(response);
}

export const authApi = {
  login: (payload: MobileLoginRequest): Promise<MobileLoginResponse> =>
    requestRaw<MobileLoginResponse>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
  refresh: (refreshToken: string): Promise<MobileRefreshResponse> =>
    requestRaw<MobileRefreshResponse>("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken })
    }),
  me: (accessToken: string): Promise<MobileMeResponse> =>
    requestRaw<MobileMeResponse>("/auth/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` }
    })
};

export const checkinApi = {
  scanCheckin: (token: string, payload: MobileCheckinScanRequest): Promise<MobileCheckinScanResponse> =>
    requestData<MobileCheckinScanResponse>("/checkin/scan", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }),
  syncCheckins: (token: string, items: MobileCheckinSyncItemRequest[]): Promise<MobileCheckinSyncResponse> =>
    requestData<MobileCheckinSyncResponse>("/checkin/sync", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ items })
    })
};
