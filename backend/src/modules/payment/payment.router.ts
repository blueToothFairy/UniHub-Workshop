import { Router, type Request, type Response } from "express";
import { AppError } from "../../shared/errors/AppError.js";
import type { MomoCallbackPayload } from "./payment.types.js";
import type { RegistrationService } from "../registration/registration.service.js";

export function createPaymentRouter(registrationService: RegistrationService): Router {
  const router = Router();

  router.post("/momo/callback", async (req: Request, res: Response) => {
    try {
      const payload = req.body as Partial<MomoCallbackPayload>;
      if (!payload || typeof payload.orderId !== "string" || typeof payload.signature !== "string") {
        throw new AppError(400, "INVALID_CALLBACK_PAYLOAD", "Missing required MoMo callback fields");
      }

      await registrationService.handleMomoCallback({
        partnerCode: String(payload.partnerCode ?? ""),
        orderId: payload.orderId,
        requestId: String(payload.requestId ?? ""),
        amount: Number(payload.amount ?? 0),
        orderInfo: String(payload.orderInfo ?? ""),
        orderType: payload.orderType ? String(payload.orderType) : undefined,
        transId: payload.transId !== undefined ? Number(payload.transId) : undefined,
        resultCode: String(payload.resultCode ?? ""),
        message: String(payload.message ?? ""),
        payType: payload.payType ? String(payload.payType) : undefined,
        responseTime: payload.responseTime !== undefined ? Number(payload.responseTime) : undefined,
        extraData: payload.extraData ? String(payload.extraData) : undefined,
        signature: payload.signature
      });
      res.json({ data: { status: "ok" } });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.post("/jobs/reconcile", async (_req: Request, res: Response) => {
    try {
      const data = await registrationService.runReconciliationBatch();
      res.json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.post("/jobs/expire", async (_req: Request, res: Response) => {
    try {
      await registrationService.expireStaleRegistrations();
      res.json({ data: { status: "ok" } });
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
