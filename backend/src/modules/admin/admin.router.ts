import { Router, type Request, type Response } from "express";
import { AppError } from "../../shared/errors/AppError.js";
import type { AdminService } from "./admin.service.js";
import type { CreateWorkshopInput, UpdateWorkshopInput } from "./admin.types.js";

export function createAdminRouter(adminService: AdminService): Router {
  const router: Router = Router();

  router.get("/dashboard/stats", async (_req: Request, res: Response) => {
    try {
      res.json({ data: await adminService.getDashboardStats() });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.get("/workshops", async (_req: Request, res: Response) => {
    try {
      res.json({ data: await adminService.listWorkshops() });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.post("/workshops", async (req: Request, res: Response) => {
    try {
      const payload: CreateWorkshopInput = req.body as CreateWorkshopInput;
      res.status(201).json({ data: await adminService.createWorkshop(payload, req.user!.sub) });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.put("/workshops/:id", async (req: Request, res: Response) => {
    try {
      const payload: UpdateWorkshopInput = req.body as UpdateWorkshopInput;
      res.json({ data: await adminService.updateWorkshop(req.params.id, payload, req.user!.sub) });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.post("/workshops/:id/cancel", async (req: Request, res: Response) => {
    try {
      res.json({ data: await adminService.cancelWorkshop(req.params.id, req.user!.sub) });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.get("/audit-logs", async (_req: Request, res: Response) => {
    try {
      res.json({ data: await adminService.listAuditLogs() });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  return router;
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    return;
  }
  res.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: "Unexpected server error" } });
}
