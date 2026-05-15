function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

const API_BASE_URL: string = normalizeApiBaseUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000"
);

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
  student_name: string | null;
  student_id: string | null;
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
  student_name: string | null;
  student_id: string | null;
  error_code: string | null;
}

export interface MobileCheckinSyncResponse {
  results: MobileCheckinSyncItemResponse[];
}

export interface WorkshopListItem {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  status: string;
}

export interface WorkshopListResponse {
  workshops: WorkshopListItem[];
  stats?: unknown;
}

export type RosterRegistrationStatus = "confirmed" | "cancelled" | "expired";

export interface MobileWorkshopRosterEntry {
  registration_id: string;
  student_user_id: string;
  student_name: string;
  student_id: string | null;
  registration_status: RosterRegistrationStatus;
}

export interface MobileWorkshopRosterResponse {
  workshop_id: string;
  server_time: string;
  roster: MobileWorkshopRosterEntry[];
}

export interface CancelledRegistrationEntry {
  registration_id: string;
  cancelled_at: string;
}

export interface MobileCancelledSinceResponse {
  cancelled: CancelledRegistrationEntry[];
  server_time: string;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
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
  const response: Response = await performFetch(path, init);
  return parseRawResponse<T>(response);
}

async function requestData<T>(path: string, init: RequestInit): Promise<T> {
  const response: Response = await performFetch(path, init);
  return parseDataEnvelope<T>(response);
}

async function performFetch(path: string, init: RequestInit): Promise<Response> {
  const url = `${API_BASE_URL}${path}`;

  try {
    return await fetch(url, init);
  } catch (error: unknown) {
    const reason = error instanceof Error && error.message
      ? error.message
      : "Network request failed";

    throw new ApiError(
      0,
      "NETWORK_ERROR",
      `Unable to reach backend at ${url}. ${reason}`
    );
  }
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
    }),
  getRoster: (token: string, workshopId: string, after?: string): Promise<MobileWorkshopRosterResponse> => {
    const params = new URLSearchParams({ workshop_id: workshopId });
    if (after) {
      params.set("after", after);
    }
    return requestData<MobileWorkshopRosterResponse>(`/checkin/roster?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
  },
  getCancelledSince: (token: string, after?: string): Promise<MobileCancelledSinceResponse> => {
    const params = new URLSearchParams();
    if (after) {
      params.set("after", after);
    }
    const suffix = params.toString();
    return requestData<MobileCancelledSinceResponse>(`/checkin/cancelled-since${suffix ? `?${suffix}` : ""}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
  }
};

export const workshopApi = {
  listWorkshops: (): Promise<WorkshopListResponse> =>
    requestData<WorkshopListResponse>("/workshops", {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    })
};
