import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/AppError.js";
import { decodeAuditLogCursor, encodeAuditLogCursor } from "./admin-audit-log-cursor.js";

test("encodeAuditLogCursor round-trips createdAt and id", () => {
  const createdAt = "2026-05-16T10:00:00.000Z";
  const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const cursor = encodeAuditLogCursor(createdAt, id);
  assert.deepEqual(decodeAuditLogCursor(cursor), { createdAt, id });
});

test("decodeAuditLogCursor rejects invalid cursor", () => {
  assert.throws(
    () => decodeAuditLogCursor("not-a-valid-cursor"),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_AUDIT_LOG_CURSOR"
  );
});
