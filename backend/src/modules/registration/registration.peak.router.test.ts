import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { authenticate } from "../auth/auth.middleware.js";
import { authorize } from "../../shared/middleware/authorize.js";
import { AppError } from "../../shared/errors/AppError.js";
import { createRegistrationRouter } from "./registration.router.js";
import { RetryAfterAppError } from "./peak-admission.service.js";
import { createWorkshopPeakRouter } from "./workshop-peak.router.js";

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

test("registration router returns 403 ADMISSION_TOKEN_REQUIRED", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/registrations",
    authenticate,
    authorize(["student"]),
    createRegistrationRouter({
      async createRegistration() {
        throw new AppError(403, "ADMISSION_TOKEN_REQUIRED", "Admission token required");
      }
    } as never)
  );

  const token = createAccessToken();
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/registrations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "idempotency-1"
      },
      body: JSON.stringify({ workshop_id: "w1" })
    });
    assert.equal(response.status, 403);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "ADMISSION_TOKEN_REQUIRED");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("registration router returns 403 ADMISSION_TOKEN_INVALID", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/registrations",
    authenticate,
    authorize(["student"]),
    createRegistrationRouter({
      async createRegistration() {
        throw new AppError(403, "ADMISSION_TOKEN_INVALID", "Admission token invalid");
      }
    } as never)
  );

  const token = createAccessToken();
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/registrations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "idempotency-1",
        "Admission-Token": "bad-token"
      },
      body: JSON.stringify({ workshop_id: "w1" })
    });
    assert.equal(response.status, 403);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "ADMISSION_TOKEN_INVALID");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("workshop peak router returns 429 RATE_LIMITED with retry_after", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/workshops",
    authenticate,
    authorize(["student"]),
    createWorkshopPeakRouter({
      async getRegistrationGate() {
        throw new RetryAfterAppError(429, "RATE_LIMITED", "Too many polls", 3);
      },
      async requestAdmission() {
        throw new Error("not used");
      },
      async validateRegistrationAttempt() {}
    })
  );

  const token = createAccessToken();
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/workshops/w1/registration-gate`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 429);
    const body = await response.json() as {
      error?: { code?: string };
      retry_after?: number;
    };
    assert.equal(body.error?.code, "RATE_LIMITED");
    assert.equal(body.retry_after, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("registration router returns 503 REGISTRATION_BUSY with retry_after", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/registrations",
    authenticate,
    authorize(["student"]),
    createRegistrationRouter({
      async createRegistration() {
        throw new RetryAfterAppError(503, "REGISTRATION_BUSY", "Busy", 1);
      }
    } as never)
  );

  const token = createAccessToken();
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await fetch(`${baseUrl}/registrations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "idempotency-1",
        "Admission-Token": "token-1"
      },
      body: JSON.stringify({ workshop_id: "w1" })
    });
    assert.equal(response.status, 503);
    const body = await response.json() as {
      error?: string;
      retry_after?: number;
    };
    assert.equal(body.error, "REGISTRATION_BUSY");
    assert.equal(body.retry_after, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
