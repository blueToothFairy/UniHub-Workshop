import { Router, type Request, type Response } from "express";
import type { ParsedQs } from "qs";
import { AppError } from "../../shared/errors/AppError.js";
import type { WorkshopService } from "./workshop.service.js";

export function createWorkshopRouter(workshopService: WorkshopService): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    try {
      const data = await workshopService.listWorkshopsForThisMonth({
        q: toStringOrStringArray(req.query.q),
        payment: toStringOrStringArray(req.query.payment),
        available_only: toStringOrStringArray(req.query.available_only)
      });
      res.json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const data = await workshopService.getWorkshopDetail(req.params.id);

      // Set caching headers for read-heavy student pages. Use `updatedAt` as
      // the basis for ETag and Last-Modified so clients can cache safely.
      if (data?.updatedAt) {
        res.setHeader("ETag", `"${data.updatedAt}"`);
        try {
          res.setHeader("Last-Modified", new Date(data.updatedAt).toUTCString());
        } catch {
          // ignore invalid dates
        }
      }
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");

      res.json({ data });
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  return router;
}

function toStringOrStringArray(input: unknown): string | string[] | undefined {
  if (typeof input === "string") return input;
  if (Array.isArray(input) && input.every((item) => typeof item === "string")) {
    return input;
  }
  return undefined;
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    return;
  }
  res.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: "Unexpected server error" } });
}
