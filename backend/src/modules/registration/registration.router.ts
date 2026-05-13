import { Router, type Request, type Response } from "express";
import { AppError } from "../../shared/errors/AppError.js";
import type { RegistrationService } from "./registration.service.js";
import type { CreateRegistrationRequest } from "./registration.types.js";
import { PaymentGatewayUnavailableError } from "../payment/payment-circuit-breaker.service.js";
import { RetryAfterAppError } from "./peak-admission.service.js";

export function createRegistrationRouter(registrationService: RegistrationService): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    try {
      const payload = req.body as CreateRegistrationRequest;
      if (!payload?.workshop_id) {
        throw new AppError(400, "WORKSHOP_ID_REQUIRED", "workshop_id is required");
      }
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
        throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
      }
      const data = await registrationService.createRegistration({
        workshopId: payload.workshop_id,
        userId: req.user!.sub,
        idempotencyKey,
        admissionToken: typeof req.headers["admission-token"] === "string" ? req.headers["admission-token"] : null
      });
      if (data.registration_status === "confirmed") {
        res.status(201).json({ data });
        return;
      }
      res.status(201).json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.get("/workshops/:workshopId/current", async (req: Request, res: Response) => {
    try {
      const data = await registrationService.getCurrentRegistrationForWorkshop({
        workshopId: req.params.workshopId,
        userId: req.user!.sub
      });
      res.json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.get("/:id/payment-status", async (req: Request, res: Response) => {
    try {
      const data = await registrationService.getPaymentStatus({
        registrationId: req.params.id,
        userId: req.user!.sub
      });
      res.json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.get("/:id/qr", async (req: Request, res: Response) => {
    try {
      const data = await registrationService.getRegistrationQr({
        registrationId: req.params.id,
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
  if (error instanceof PaymentGatewayUnavailableError) {
    res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
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
