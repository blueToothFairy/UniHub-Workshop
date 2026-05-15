import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { authenticate } from "../auth/auth.middleware.js";
import { authorize } from "../../shared/middleware/authorize.js";
import { createCheckinRouter } from "./checkin.router.js";

async function startServer(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server failed to start");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function createAccessToken(role: string): string {
  const secret = "test-secret";
  process.env.JWT_SECRET = secret;
  return jwt.sign({ sub: "user-1", email: "u@example.com", role, type: "access" }, secret);
}

test("checkin routes return 401 without token", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/checkin",
    authenticate,
    authorize(["checkin_staff"]),
    createCheckinRouter({
      async getRoster() {
        return { workshop_id: "w1", server_time: new Date().toISOString(), roster: [] };
      },
      async getCancelledSince() {
        return { cancelled: [], server_time: new Date().toISOString() };
      },
      async scan() {
        return {
          result: "checked_in",
          registration_id: "r1",
          workshop_id: "w1",
          student_name: null,
          student_id: null,
          checked_in_at: new Date().toISOString()
        };
      },
      async sync() {
        return { results: [] };
      }
    } as any)
  );

  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/checkin/roster?workshop_id=w1`);
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "UNAUTHORIZED");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("checkin routes return 403 for non-staff role", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/checkin",
    authenticate,
    authorize(["checkin_staff"]),
    createCheckinRouter({
      async getRoster() {
        return { workshop_id: "w1", server_time: new Date().toISOString(), roster: [] };
      },
      async getCancelledSince() {
        return { cancelled: [], server_time: new Date().toISOString() };
      },
      async scan() {
        return {
          result: "checked_in",
          registration_id: "r1",
          workshop_id: "w1",
          student_name: null,
          student_id: null,
          checked_in_at: new Date().toISOString()
        };
      },
      async sync() {
        return { results: [] };
      }
    } as any)
  );

  const token = createAccessToken("student");
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/checkin/scan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ qr_token: "t" })
    });
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "FORBIDDEN");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("checkin scan requires qr_token (400 QR_TOKEN_REQUIRED)", async () => {
  const app = express();
  app.use(express.json());

  let seenActorUserId: string | null = null;
  app.use(
    "/checkin",
    authenticate,
    authorize(["checkin_staff"]),
    createCheckinRouter({
      async getRoster() {
        return { workshop_id: "w1", server_time: new Date().toISOString(), roster: [] };
      },
      async getCancelledSince() {
        return { cancelled: [], server_time: new Date().toISOString() };
      },
      async scan(input: { actorUserId: string }) {
        seenActorUserId = input.actorUserId;
        return {
          result: "checked_in",
          registration_id: "r1",
          workshop_id: "w1",
          student_name: null,
          student_id: null,
          checked_in_at: new Date().toISOString()
        };
      },
      async sync() {
        return { results: [] };
      }
    } as any)
  );

  const token = createAccessToken("checkin_staff");
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/checkin/scan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "QR_TOKEN_REQUIRED");
    assert.equal(seenActorUserId, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("checkin sync requires items array (400 INVALID_SYNC_PAYLOAD)", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/checkin",
    authenticate,
    authorize(["checkin_staff"]),
    createCheckinRouter({
      async getRoster() {
        return { workshop_id: "w1", server_time: new Date().toISOString(), roster: [] };
      },
      async getCancelledSince() {
        return { cancelled: [], server_time: new Date().toISOString() };
      },
      async scan() {
        return {
          result: "checked_in",
          registration_id: "r1",
          workshop_id: "w1",
          student_name: null,
          student_id: null,
          checked_in_at: new Date().toISOString()
        };
      },
      async sync() {
        return { results: [] };
      }
    } as any)
  );

  const token = createAccessToken("checkin_staff");
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/checkin/sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [] })
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "INVALID_SYNC_PAYLOAD");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("checkin roster requires workshop_id (400 WORKSHOP_ID_REQUIRED)", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/checkin",
    authenticate,
    authorize(["checkin_staff"]),
    createCheckinRouter({
      async getRoster() {
        return { workshop_id: "w1", server_time: new Date().toISOString(), roster: [] };
      },
      async getCancelledSince() {
        return { cancelled: [], server_time: new Date().toISOString() };
      },
      async scan() {
        return {
          result: "checked_in",
          registration_id: "r1",
          workshop_id: "w1",
          student_name: null,
          student_id: null,
          checked_in_at: new Date().toISOString()
        };
      },
      async sync() {
        return { results: [] };
      }
    } as any)
  );

  const token = createAccessToken("checkin_staff");
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/checkin/roster`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "WORKSHOP_ID_REQUIRED");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
