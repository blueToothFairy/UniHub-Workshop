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
import { BullMqQueue } from "./shared/infra/queue.js";
import { PgDatabase } from "./shared/infra/pgDatabase.js";
import { WorkshopSummaryRepository } from "./modules/ai-summary/ai-summary.repository.js";
import { GeminiSummarizer } from "./modules/ai-summary/gemini.summarizer.js";
import { AiSummaryService } from "./modules/ai-summary/ai-summary.service.js";
import { AiSummaryWorker } from "./workers/ai-summary.worker.js";
import { CloudinaryPdfStorage } from "./modules/ai-summary/cloudinary-pdf.storage.js";

const app: Express = express();
const allowedOrigins: string[] = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3001").split(",").map((s) => s.trim());
const database: PgDatabase = new PgDatabase();
const redisUrl = process.env.REDIS_URL ?? "";
if (!redisUrl) {
  throw new Error("REDIS_URL is required for BullMQ queue");
}
const queue = new BullMqQueue(redisUrl);

const workshopSummaryRepository = new WorkshopSummaryRepository(database);
const aiSummaryService = new AiSummaryService(workshopSummaryRepository, new CloudinaryPdfStorage(), new GeminiSummarizer(), queue);
const aiSummaryWorker = new AiSummaryWorker(aiSummaryService);
queue.startAiSummaryWorker((payload) => aiSummaryWorker.consume(payload));

const adminService: AdminService = new AdminService(queue, database, aiSummaryService);
const authService: AuthService = new AuthService(database);
const workshopService = new WorkshopService(adminService);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  })
);
app.options("*", cors({ origin: allowedOrigins, credentials: true, allowedHeaders: ["Authorization", "Content-Type", "Accept"] }));
app.use(express.json({ limit: "10mb" }));
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", createAuthRouter(authService));
app.use("/admin", authenticate, authorize(["organizer"]), createAdminRouter(adminService));
app.use("/workshops", createWorkshopRouter(workshopService));

const port: number = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend API listening on :${port}`);
});
