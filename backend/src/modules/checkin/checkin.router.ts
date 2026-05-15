import { Router, type Request, type Response } from "express";
import { AppError } from "../../shared/errors/AppError.js";
import type { CheckinService } from "./checkin.service.js";
import type { CheckinScanRequest, CheckinSyncRequest } from "./checkin.types.js";

export function createCheckinRouter(checkinService: CheckinService): Router {
  const router = Router();

  router.get("/roster", async (req: Request, res: Response) => {
    try {
      const workshopId = String(req.query.workshop_id ?? "").trim();
      if (!workshopId) {
        throw new AppError(400, "WORKSHOP_ID_REQUIRED", "workshop_id is required");
      }
      const after = typeof req.query.after === "string" ? req.query.after : undefined;
      const data = await checkinService.getRoster(workshopId, after);
      res.json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.get("/cancelled-since", async (req: Request, res: Response) => {
    try {
      const after = typeof req.query.after === "string" ? req.query.after : undefined;
      const data = await checkinService.getCancelledSince(after);
      res.json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.post("/scan", async (req: Request, res: Response) => {
    try {
      const payload = req.body as CheckinScanRequest;
      if (!payload?.qr_token) {
        throw new AppError(400, "QR_TOKEN_REQUIRED", "qr_token is required");
      }
      const data = await checkinService.scan({
        actorUserId: req.user!.sub,
        qrToken: payload.qr_token,
        workshopId: payload.workshop_id
      });
      res.json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.post("/sync", async (req: Request, res: Response) => {
    try {
      const payload = req.body as CheckinSyncRequest;
      if (!Array.isArray(payload?.items) || payload.items.length === 0) {
        throw new AppError(400, "INVALID_SYNC_PAYLOAD", "items array is required");
      }
      const data = await checkinService.sync({
        actorUserId: req.user!.sub,
        items: payload.items
      });
      res.json({ data });
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
