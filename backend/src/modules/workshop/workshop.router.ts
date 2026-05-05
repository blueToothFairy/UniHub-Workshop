import { Router, type Request, type Response } from "express";
import { AppError } from "../../shared/errors/AppError.js";
import type { WorkshopService } from "./workshop.service.js";

export function createWorkshopRouter(workshopService: WorkshopService): Router {
  const router = Router();

  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const data = await workshopService.getWorkshopDetail(req.params.id);
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
