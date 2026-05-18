import type { MobileCheckinScanResponse, MobileCheckinSyncResult } from "./api";

export type StaffResultTone = "success" | "warning" | "error" | "info";

export interface StaffResultCard {
  tone: StaffResultTone;
  title: string;
  detail: string;
  stamp?: string;
}

export interface QueueStatusSnapshot {
  pending: number;
  retained: number;
}

function formatStamp(iso: string | null | undefined): string | undefined {
  if (!iso) {
    return undefined;
  }

  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString();
}

export function buildCheckedInCard(response: MobileCheckinScanResponse): StaffResultCard {
  const studentLabel = response.student_name
    ? `${response.student_name}${response.student_id ? ` (${response.student_id})` : ""}`
    : response.student_id
      ? response.student_id
      : `Registration ${response.registration_id}`;

  if (response.result === "checked_in") {
    return {
      tone: "success",
      title: "Checked in",
      detail: `${studentLabel} was accepted for workshop ${response.workshop_id}.`,
      stamp: formatStamp(response.checked_in_at)
    };
  }

  return {
    tone: "warning",
    title: "Already checked in",
    detail: `${studentLabel} was already recorded for workshop ${response.workshop_id}.`,
    stamp: formatStamp(response.checked_in_at)
  };
}

export function buildOfflineQueuedCard(scannedAt: string): StaffResultCard {
  return {
    tone: "info",
    title: "Queued offline",
    detail: "The scan was saved on this device and will stay pending until you sync.",
    stamp: formatStamp(scannedAt)
  };
}

export function buildDomainErrorCard(code: string, message: string): StaffResultCard {
  const fallback: StaffResultCard = {
    tone: "error",
    title: "Check-in failed",
    detail: message
  };

  switch (code) {
    case "NETWORK_ERROR":
      return {
        tone: "warning",
        title: "Cannot reach backend",
        detail: message
      };
    case "INVALID_QR_TOKEN":
      return { tone: "error", title: "Invalid QR", detail: "This QR code is invalid or expired." };
    case "WORKSHOP_MISMATCH":
      return { tone: "error", title: "Wrong workshop", detail: "This QR code does not belong to the current workshop context." };
    case "REGISTRATION_NOT_CONFIRMED":
      return { tone: "error", title: "Registration not confirmed", detail: "The student registration is not confirmed yet." };
    case "WORKSHOP_CANCELLED":
      return { tone: "error", title: "Workshop cancelled", detail: "This workshop is cancelled, so check-in is unavailable." };
    case "UNAUTHORIZED":
    case "INVALID_TOKEN":
      return { tone: "warning", title: "Session expired", detail: "Sign in again to continue checking in students." };
    default:
      return fallback;
  }
}

export function buildSyncSummaryCard(processed: number, cleared: number, retained: number): StaffResultCard {
  if (processed === 0) {
    return {
      tone: "info",
      title: "Nothing to sync",
      detail: "There are no pending check-ins waiting on this device."
    };
  }

  if (retained === 0) {
    return {
      tone: "success",
      title: "Sync complete",
      detail: `${cleared} of ${processed} queued items were settled on the server.`
    };
  }

  return {
    tone: "warning",
    title: "Sync finished with retained items",
    detail: `${cleared} settled, ${retained} still need attention or retry.`
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatCheckinStudentLabel(row: {
  student_name: string | null;
  student_id: string | null;
  registration_id: string | null;
}): string {
  if (row.student_name) {
    return row.student_id
      ? `${row.student_name} (${row.student_id})`
      : row.student_name;
  }

  if (row.student_id) {
    return row.student_id;
  }

  if (row.registration_id && !UUID_PATTERN.test(row.registration_id)) {
    return row.registration_id;
  }

  return "Unknown student";
}

export function buildRetainedReasonLabel(result: MobileCheckinSyncResult, errorCode: string | null): string {
  if (errorCode) {
    return errorCode.replaceAll("_", " ");
  }

  switch (result) {
    case "invalid_qr":
      return "INVALID QR";
    case "registration_not_confirmed":
      return "REGISTRATION NOT CONFIRMED";
    case "workshop_mismatch":
      return "WORKSHOP MISMATCH";
    case "workshop_cancelled":
      return "WORKSHOP CANCELLED";
    default:
      return result.replaceAll("_", " ");
  }
}
