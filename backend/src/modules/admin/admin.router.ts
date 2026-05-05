import express, { Router, type Request, type Response } from "express";
import { AppError } from "../../shared/errors/AppError.js";
import type { AdminService } from "./admin.service.js";
import type { CreateWorkshopInput, OverrideSummaryInput, UpdateWorkshopInput } from "./admin.types.js";

interface MultipartPdf {
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

function parsePdfMultipart(contentTypeHeader: string | undefined, body: Buffer): MultipartPdf {
  if (!contentTypeHeader || !contentTypeHeader.includes("multipart/form-data")) {
    throw new AppError(400, "INVALID_PDF_TYPE", "Expected multipart/form-data upload");
  }

  const boundaryMatch = contentTypeHeader.match(/boundary=(.+)$/i);
  if (!boundaryMatch) {
    throw new AppError(400, "INVALID_MULTIPART", "Missing multipart boundary");
  }

  const boundary = `--${boundaryMatch[1]}`;
  const raw = body.toString("binary");
  const parts = raw.split(boundary).filter((part) => part.includes("Content-Disposition"));
  const filePart = parts.find((part) => /name="file"/i.test(part));
  if (!filePart) {
    throw new AppError(400, "FILE_REQUIRED", "Missing file field");
  }

  const headerEndIndex = filePart.indexOf("\r\n\r\n");
  if (headerEndIndex === -1) {
    throw new AppError(400, "INVALID_MULTIPART", "Invalid multipart file payload");
  }

  const headers = filePart.slice(0, headerEndIndex);
  const fileDataWithSuffix = filePart.slice(headerEndIndex + 4);
  const fileData = fileDataWithSuffix.replace(/\r\n--$/, "").replace(/\r\n$/, "");

  const fileNameMatch = headers.match(/filename="([^"]+)"/i);
  const partContentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
  const fileName = fileNameMatch?.[1] ?? "upload.pdf";
  const partContentType = (partContentTypeMatch?.[1] ?? "").trim();

  return {
    fileName,
    contentType: partContentType,
    bytes: Buffer.from(fileData, "binary")
  };
}

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

  router.get("/workshops/:id", async (req: Request, res: Response) => {
    try {
      res.json({ data: await adminService.getWorkshopDetail(req.params.id) });
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

  router.post("/workshops/:id/pdf", express.raw({ type: () => true, limit: "10mb" }), async (req: Request, res: Response) => {
    try {
      const parsed = parsePdfMultipart(req.headers["content-type"], req.body as Buffer);
      const data = await adminService.uploadWorkshopPdf(req.params.id, parsed.fileName, parsed.contentType, parsed.bytes);
      res.status(202).json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.put("/workshops/:id/summary", async (req: Request, res: Response) => {
    try {
      const payload = req.body as OverrideSummaryInput;
      await adminService.overrideWorkshopSummary(req.params.id, payload);
      res.status(204).send();
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
