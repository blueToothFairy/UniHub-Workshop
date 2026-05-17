import { AppError } from "../../shared/errors/AppError.js";

export function encodeAuditLogCursor(createdAtIso: string, id: string): string {
  return Buffer.from(`${createdAtIso}|${id}`, "utf8").toString("base64url");
}

export function decodeAuditLogCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const splitIndex = raw.lastIndexOf("|");
    if (splitIndex <= 0 || splitIndex >= raw.length - 1) {
      throw new Error("Invalid cursor");
    }
    return {
      createdAt: raw.slice(0, splitIndex),
      id: raw.slice(splitIndex + 1)
    };
  } catch {
    throw new AppError(400, "INVALID_AUDIT_LOG_CURSOR", "Cursor is invalid");
  }
}
