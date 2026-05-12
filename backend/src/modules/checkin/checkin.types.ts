export type CheckinSource = "online_scan" | "offline_sync";
export type CheckinScanResult = "checked_in" | "already_checked_in";
export type CheckinSyncResult =
  | "checked_in"
  | "already_checked_in"
  | "invalid_qr"
  | "registration_not_confirmed"
  | "workshop_mismatch"
  | "workshop_cancelled";

export interface CheckinScanRequest {
  qr_token: string;
  workshop_id?: string;
}

export interface CheckinScanResponse {
  result: CheckinScanResult;
  registration_id: string;
  workshop_id: string;
  checked_in_at: string;
}

export interface CheckinSyncItemRequest {
  device_id: string;
  device_scan_id: string;
  qr_token: string;
  workshop_id?: string;
  scanned_at_device: string;
}

export interface CheckinSyncRequest {
  items: CheckinSyncItemRequest[];
}

export interface CheckinSyncItemResponse {
  device_scan_id: string;
  result: CheckinSyncResult;
  registration_id: string | null;
  checked_in_at: string | null;
  error_code: string | null;
}

export interface CheckinSyncResponse {
  results: CheckinSyncItemResponse[];
}

export interface CheckinQrPayload {
  type: "workshop_checkin";
  registration_id: string;
  workshop_id: string;
  user_id: string;
  exp: number;
  iat?: number;
}
