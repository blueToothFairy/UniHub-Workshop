import { Router, type Request, type Response } from "express";
import { AppError } from "../../shared/errors/AppError.js";
import { rateLimitLogin } from "../../shared/middleware/rateLimiter.js";
import { authenticate } from "./auth.middleware.js";
import { AuthService } from "./auth.service.js";
import type { ChangePasswordRequest, LoginRequest, RefreshRequest, RegisterRequest } from "./auth.types.js";

export function createAuthRouter(authService: AuthService): Router {
  const router: Router = Router();

  router.post("/register", async (req: Request, res: Response) => {
    try {
      const payload: RegisterRequest = req.body as RegisterRequest;
      const data = await authService.register(payload, req.ip ?? "", req.headers["user-agent"] ?? "");
      res.status(201).json(data);
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.post("/login", rateLimitLogin, async (req: Request, res: Response) => {
    try {
      console.log(`Login attempt from IP ${req.ip} with User-Agent ${req.headers["user-agent"]}`);
      console.log(`Request body: ${JSON.stringify(req.body)}`);
      const payload: LoginRequest = req.body as LoginRequest;
      const data = await authService.login(payload, req.ip ?? "", req.headers["user-agent"] ?? "");
      res.json(data);
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.post("/refresh", async (req: Request, res: Response) => {
    try {
      let payload: RefreshRequest = req.body as RefreshRequest;
      if (!payload || !payload.refresh_token) {
        const cookieHeader = req.headers.cookie;
        if (typeof cookieHeader === "string") {
          const pairs = cookieHeader.split(";").map((c) => c.trim());
          for (const p of pairs) {
            const idx = p.indexOf("=");
            if (idx === -1) continue;
            const name = p.slice(0, idx);
            const val = p.slice(idx + 1);
            if (name === "refresh_token") {
              payload = { refresh_token: decodeURIComponent(val) } as RefreshRequest;
              break;
            }
          }
        }
      }

      const data = await authService.refresh(payload, req.ip ?? "", req.headers["user-agent"] ?? "");
      res.json(data);
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.post("/logout", authenticate, async (req: Request, res: Response) => {
    try {
      const payload: RefreshRequest = req.body as RefreshRequest;
      await authService.logout(payload.refresh_token);
      res.status(204).send();
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.post("/change-password", authenticate, async (req: Request, res: Response) => {
    try {
      const payload: ChangePasswordRequest = req.body as ChangePasswordRequest;
      await authService.changePassword(req.user!.sub, payload);
      res.status(204).send();
    } catch (error: unknown) {
      handleError(error, res);
    }
  });

  router.get("/me", authenticate, async (req: Request, res: Response) => {
    try {
      const user = await authService.me(req.user!.sub);
      res.json({ user });
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
  // Log unexpected errors to help debugging during development
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  res.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: "Unexpected server error" } });
}
