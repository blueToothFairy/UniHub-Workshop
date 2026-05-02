import "dotenv/config";
import express, { type Express } from "express";
import cors from "cors";
import { createAdminRouter } from "./modules/admin/admin.router.js";
import { AdminService } from "./modules/admin/admin.service.js";
import { createAuthRouter } from "./modules/auth/auth.router.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { authenticate } from "./modules/auth/auth.middleware.js";
import { authorize } from "./shared/middleware/authorize.js";
import { QueueStub } from "./shared/infra/queue.js";
import { PgDatabase } from "./shared/infra/pgDatabase.js";

const app: Express = express();
const allowedOrigins: string[] = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3001").split(",").map((s) => s.trim());
const database: PgDatabase = new PgDatabase();
const adminService: AdminService = new AdminService(new QueueStub(), database);
const authService: AuthService = new AuthService(database);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  })
);
app.options("*", cors({ origin: allowedOrigins, credentials: true, allowedHeaders: ["Authorization", "Content-Type", "Accept"] }));
app.use(express.json());
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", createAuthRouter(authService));
app.use("/admin", authenticate, authorize(["organizer"]), createAdminRouter(adminService));

const port: number = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend API listening on :${port}`);
});
