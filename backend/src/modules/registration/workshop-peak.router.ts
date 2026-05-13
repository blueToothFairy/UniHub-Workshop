import { Router, type Request, type Response } from "express";
import { AppError } from "../../shared/errors/AppError.js";
import { RetryAfterAppError } from "./peak-admission.service.js";
import type { IPeakAdmissionService } from "./peak-admission.types.js";

export function createWorkshopPeakRouter(peakAdmissionService: IPeakAdmissionService): Router {
  const router = Router();

  router.get("/:id/registration-gate", async (req: Request, res: Response) => {
    try {
      const data = await peakAdmissionService.getRegistrationGate({
        workshopId: req.params.id,
        userId: req.user!.sub
      });
      res.json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.post("/:id/admission", async (req: Request, res: Response) => {
    try {
      const data = await peakAdmissionService.requestAdmission({
        workshopId: req.params.id,
        userId: req.user!.sub
      });
      res.json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  return router;
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof RetryAfterAppError) {
    if (error.code === "REGISTRATION_BUSY") {
      res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
        retry_after: error.retryAfterSeconds
      });
      return;
    }
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
      retry_after: error.retryAfterSeconds
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    return;
  }
  res.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: "Unexpected server error" } });
}
