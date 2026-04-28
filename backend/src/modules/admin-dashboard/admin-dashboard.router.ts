import { Router } from "express";

import {
  getCheckinToday,
  getPaymentSummary,
  getStats
} from "./admin-dashboard.service.js";

const adminDashboardRouter = Router();

adminDashboardRouter.get("/stats", async (_req, res) => {
  const payload = await getStats();
  res.json(payload);
});

adminDashboardRouter.get("/payments", async (_req, res) => {
  const payload = await getPaymentSummary();
  res.json(payload);
});

adminDashboardRouter.get("/checkin-today", async (_req, res) => {
  const payload = await getCheckinToday();
  res.json(payload);
});

export { adminDashboardRouter };
