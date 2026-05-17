import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { authenticate } from "../auth/auth.middleware.js";
import { authorize } from "../../shared/middleware/authorize.js";
import { createAdminRouter } from "./admin.router.js";
import { AppError } from "../../shared/errors/AppError.js";
import type { AdminService } from "./admin.service.js";
import type { ListAuditLogsResponse } from "./admin.types.js";

async function startServer(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server failed to start");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function createAccessToken(role: "organizer" | "student"): string {
  const secret = "test-secret";
  process.env.JWT_SECRET = secret;
  return jwt.sign(
    { sub: "user-1", email: "user@example.com", role, type: "access" },
    secret
  );
}

function createAuditLogRouter(service: Partial<AdminService>): express.Router {
  const app = express();
  app.use(express.json());
  app.use("/admin", authenticate, authorize(["organizer"]), createAdminRouter(service as AdminService));
  return app;
}

const emptyPage: ListAuditLogsResponse = { items: [], next_cursor: null };

test("audit logs router returns 403 for non-organizer", async () => {
  const app = createAuditLogRouter({ listAuditLogs: async () => emptyPage });
  const token = createAccessToken("student");
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("audit logs router returns paginated envelope for organizer", async () => {
  const app = createAuditLogRouter({
    async listAuditLogs(query) {
      assert.equal(query.limit, 2);
      return {
        items: [{
          id: "log-1",
          actorUserId: "organizer-1",
          action: "workshop.create",
          targetType: "workshop",
          targetId: "workshop-1",
          createdAt: "2026-05-16T10:00:00.000Z"
        }],
        next_cursor: "cursor-1"
      };
    }
  });
  const token = createAccessToken("organizer");
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/admin/audit-logs?limit=2`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { data: ListAuditLogsResponse };
    assert.equal(body.data.items.length, 1);
    assert.equal(body.data.next_cursor, "cursor-1");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("audit logs router returns 400 for invalid limit from service", async () => {
  const app = createAuditLogRouter({
    async listAuditLogs() {
      throw new AppError(400, "INVALID_AUDIT_LOG_QUERY", "limit must be between 1 and 100");
    }
  });
  const token = createAccessToken("organizer");
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/admin/audit-logs?limit=0`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "INVALID_AUDIT_LOG_QUERY");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("audit logs router returns 400 for invalid cursor from service", async () => {
  const app = createAuditLogRouter({
    async listAuditLogs() {
      throw new AppError(400, "INVALID_AUDIT_LOG_CURSOR", "Cursor is invalid");
    }
  });
  const token = createAccessToken("organizer");
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/admin/audit-logs?cursor=bad`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "INVALID_AUDIT_LOG_CURSOR");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
