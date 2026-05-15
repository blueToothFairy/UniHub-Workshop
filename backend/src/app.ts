import "dotenv/config";
import express, { type Express } from "express";
import cors from "cors";
import { createAdminRouter } from "./modules/admin/admin.router.js";
import { AdminService } from "./modules/admin/admin.service.js";
import { createAuthRouter } from "./modules/auth/auth.router.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { authenticate } from "./modules/auth/auth.middleware.js";
import { createWorkshopRouter } from "./modules/workshop/workshop.router.js";
import { WorkshopService } from "./modules/workshop/workshop.service.js";
import { authorize } from "./shared/middleware/authorize.js";
import { BullMqQueue, QueueStub } from "./shared/infra/queue.js";
import { PgDatabase } from "./shared/infra/pgDatabase.js";
import { WorkshopSummaryRepository } from "./modules/ai-summary/ai-summary.repository.js";
import { GeminiSummarizer } from "./modules/ai-summary/gemini.summarizer.js";
import { AiSummaryService } from "./modules/ai-summary/ai-summary.service.js";
import { AiSummaryWorker } from "./workers/ai-summary.worker.js";
import { CloudinaryPdfStorage } from "./modules/ai-summary/cloudinary-pdf.storage.js";
import { createRegistrationRouter } from "./modules/registration/registration.router.js";
import { RegistrationService } from "./modules/registration/registration.service.js";
import { MomoAdapter } from "./modules/payment/momo.adapter.js";
import { createPaymentRouter } from "./modules/payment/payment.router.js";
import { Redis } from "ioredis";
import { PaymentCircuitBreaker } from "./modules/payment/payment-circuit-breaker.service.js";
import {
  InMemoryPaymentCircuitBreakerStore,
  type IPaymentCircuitBreakerStore,
  RedisPaymentCircuitBreakerStore
} from "./modules/payment/payment-circuit-breaker.store.js";
import { NotificationRepository } from "./modules/notification/notification.repository.js";
import { NotificationService } from "./modules/notification/notification.service.js";
import { InAppNotificationChannel } from "./modules/notification/channels/inapp.channel.js";
import { EmailNotificationChannel } from "./modules/notification/channels/email.channel.js";
import { RegistrationConfirmedWorker } from "./workers/registration-confirmed.worker.js";
import { NotificationDeliveryWorker } from "./workers/notification-delivery.worker.js";
import { createNotificationRouter } from "./modules/notification/notification.router.js";
import type { IQueue } from "./shared/interfaces/IQueue.js";

import { CheckinService } from "./modules/checkin/checkin.service.js";
import { createCheckinRouter } from "./modules/checkin/checkin.router.js";

const app: Express = express();
const allowedOrigins: string[] = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3001").split(",").map((s) => s.trim());
const allowedHeaders: string[] = ["Authorization", "Content-Type", "Accept", "Idempotency-Key"];
const database: PgDatabase = new PgDatabase();
const redisUrl = process.env.REDIS_URL ?? "";
const shouldStartWorkers: boolean = (process.env.START_WORKERS ?? (process.env.NODE_ENV === "production" ? "true" : "false")) === "true";
const shouldUseRedis: boolean = (process.env.USE_REDIS ?? (shouldStartWorkers ? "true" : "false")) === "true";

if (shouldUseRedis && !redisUrl) {
  throw new Error("REDIS_URL is required when USE_REDIS=true or START_WORKERS=true");
}

let queue: IQueue;
let paymentCircuitBreakerStore: IPaymentCircuitBreakerStore;

if (shouldUseRedis) {
  queue = new BullMqQueue(redisUrl);
  const circuitBreakerRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  circuitBreakerRedis.on("error", (error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[payment-circuit-breaker] redis error", error instanceof Error ? error.message : error);
  });
  paymentCircuitBreakerStore = new RedisPaymentCircuitBreakerStore(circuitBreakerRedis);
} else {
  queue = new QueueStub();
  paymentCircuitBreakerStore = new InMemoryPaymentCircuitBreakerStore();
}

const workshopSummaryRepository = new WorkshopSummaryRepository(database);
const aiSummaryService = new AiSummaryService(workshopSummaryRepository, new CloudinaryPdfStorage(), new GeminiSummarizer(), queue);
const aiSummaryWorker = new AiSummaryWorker(aiSummaryService);
if (shouldStartWorkers && queue instanceof BullMqQueue) {
  queue.startAiSummaryWorker((payload) => aiSummaryWorker.consume(payload));
}

const adminService: AdminService = new AdminService(queue, database, aiSummaryService);
const authService: AuthService = new AuthService(database);
const workshopService = new WorkshopService(adminService);
const momoAdapter = new MomoAdapter({
  endpoint: process.env.MOMO_ENDPOINT ?? "https://test-payment.momo.vn",
  partnerCode: process.env.MOMO_PARTNER_CODE ?? "",
  accessKey: process.env.MOMO_ACCESS_KEY ?? "",
  secretKey: process.env.MOMO_SECRET_KEY ?? "",
  redirectUrl: process.env.MOMO_REDIRECT_URL ?? "http://localhost:3001/payment-return",
  ipnUrl: process.env.MOMO_IPN_URL ?? "http://localhost:3000/payments/momo/callback",
  createOrderTimeoutMs: Number(process.env.MOMO_CREATE_ORDER_TIMEOUT_MS ?? 10_000),
  queryTimeoutMs: Number(process.env.MOMO_QUERY_TIMEOUT_MS ?? 10_000)
});
const registrationService = new RegistrationService(queue, {
  momoAdapter,
  paymentGatewayMode: (process.env.PAYMENT_GATEWAY_MODE === "simulation" ? "simulation" : "momo_sandbox"),
  paymentCircuitBreaker: new PaymentCircuitBreaker(
    paymentCircuitBreakerStore,
    {
      config: {
        failureThreshold: Number(process.env.PAYMENT_CIRCUIT_FAILURE_THRESHOLD ?? 5),
        failureWindowSeconds: Number(process.env.PAYMENT_CIRCUIT_FAILURE_WINDOW_SECONDS ?? 30),
        openDurationSeconds: Number(process.env.PAYMENT_CIRCUIT_OPEN_DURATION_SECONDS ?? 60),
        halfOpenProbeLimit: Number(process.env.PAYMENT_CIRCUIT_HALF_OPEN_PROBE_LIMIT ?? 1)
      }
    }
  )
});
const notificationRepository = new NotificationRepository();
const notificationService = new NotificationService(
  notificationRepository,
  queue,
  [
    new EmailNotificationChannel(),
    new InAppNotificationChannel(notificationRepository)
  ]
);
const registrationConfirmedWorker = new RegistrationConfirmedWorker(notificationService);
const notificationDeliveryWorker = new NotificationDeliveryWorker(notificationService);
if (queue instanceof QueueStub) {
  queue.setAiSummaryHandler((payload) => aiSummaryWorker.consume(payload));
  queue.setRegistrationConfirmedHandler((payload) => registrationConfirmedWorker.consume(payload));
  queue.setNotificationDeliveryHandler((payload) => notificationDeliveryWorker.consume(payload));
}
if (shouldStartWorkers && queue instanceof BullMqQueue) {
  queue.startRegistrationConfirmedWorker((payload) => registrationConfirmedWorker.consume(payload));
  queue.startNotificationDeliveryWorker((payload) => notificationDeliveryWorker.consume(payload));
}
const checkinService = new CheckinService(database);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  })
);
app.options("*", cors({ origin: allowedOrigins, credentials: true, allowedHeaders }));
app.use(express.json({ limit: "10mb" }));
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", createAuthRouter(authService));
app.use("/admin", authenticate, authorize(["organizer"]), createAdminRouter(adminService));
app.use("/workshops", createWorkshopRouter(workshopService));
app.use("/registrations", authenticate, authorize(["student"]), createRegistrationRouter(registrationService));
app.use("/notifications", authenticate, authorize(["student"]), createNotificationRouter(notificationService));
app.use("/checkin", authenticate, authorize(["checkin_staff"]), createCheckinRouter(checkinService));
app.use("/payments", createPaymentRouter(registrationService));

const port: number = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend API listening on :${port}`);
  if (!shouldUseRedis) {
    // eslint-disable-next-line no-console
    console.log("Redis disabled; using in-memory queue and payment circuit breaker state.");
  }
  if (!shouldStartWorkers) {
    // eslint-disable-next-line no-console
    console.log("Workers disabled (set START_WORKERS=true to enable BullMQ workers).");
  }
});
