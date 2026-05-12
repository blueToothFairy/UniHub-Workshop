import { Router, type Request, type Response } from "express";
import { AppError } from "../../shared/errors/AppError.js";
import type { NotificationService } from "./notification.service.js";

export function createNotificationRouter(notificationService: NotificationService): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const data = await notificationService.listNotifications(req.user!.sub, { limit, cursor });
      res.json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.get("/unread-count", async (req: Request, res: Response) => {
    try {
      const data = await notificationService.getUnreadCount(req.user!.sub);
      res.json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.post("/:id/read", async (req: Request, res: Response) => {
    try {
      const data = await notificationService.markNotificationRead(req.user!.sub, req.params.id);
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

