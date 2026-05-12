import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { authenticate } from "../auth/auth.middleware.js";
import { createNotificationRouter } from "./notification.router.js";
import { AppError } from "../../shared/errors/AppError.js";

async function startServer(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server failed to start");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function createAccessToken(): string {
  const secret = "test-secret";
  process.env.JWT_SECRET = secret;
  return jwt.sign(
    { sub: "student-1", email: "student@example.com", role: "student", type: "access" },
    secret
  );
}

test("notification router returns 401 without token", async () => {
  const app = express();
  app.use(express.json());
  app.use("/notifications", authenticate, createNotificationRouter({
    async listNotifications() { return { items: [], next_cursor: null }; },
    async getUnreadCount() { return { unread_count: 0 }; },
    async markNotificationRead() { return { id: "n1", is_read: true as const, read_at: new Date().toISOString() }; }
  } as never));

  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/notifications`);
    assert.equal(response.status, 401);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "UNAUTHORIZED");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("notification router returns list and unread count for authenticated student", async () => {
  const app = express();
  app.use(express.json());
  app.use("/notifications", authenticate, createNotificationRouter({
    async listNotifications() {
      return {
        items: [{ id: "n1", title: "t", body: "b", type: "registration_confirmed", created_at: new Date().toISOString(), is_read: false }],
        next_cursor: null
      };
    },
    async getUnreadCount() { return { unread_count: 1 }; },
    async markNotificationRead() { return { id: "n1", is_read: true as const, read_at: new Date().toISOString() }; }
  } as never));

  const token = createAccessToken();
  const { server, baseUrl } = await startServer(app);
  try {
    const listResponse = await fetch(`${baseUrl}/notifications`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json() as { data: { items: unknown[]; next_cursor: string | null } };
    assert.equal(Array.isArray(listBody.data.items), true);
    assert.equal(listBody.data.next_cursor, null);

    const unreadResponse = await fetch(`${baseUrl}/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(unreadResponse.status, 200);
    const unreadBody = await unreadResponse.json() as { data: { unread_count: number } };
    assert.equal(unreadBody.data.unread_count, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("notification router returns 404 for mark-read missing resource", async () => {
  const app = express();
  app.use(express.json());
  app.use("/notifications", authenticate, createNotificationRouter({
    async listNotifications() { return { items: [], next_cursor: null }; },
    async getUnreadCount() { return { unread_count: 0 }; },
    async markNotificationRead() {
      throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
    }
  } as never));

  const token = createAccessToken();
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/notifications/does-not-exist/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 404);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "NOTIFICATION_NOT_FOUND");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

