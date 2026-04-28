import express from "express";

import { adminDashboardRouter } from "./modules/admin-dashboard/admin-dashboard.router.js";

const app = express();

app.use(express.json());
app.use("/admin/dashboard", adminDashboardRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const port = Number(process.env.PORT ?? 3001);

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}

export { app };
