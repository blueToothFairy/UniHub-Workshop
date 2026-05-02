import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AccessTokenPayload } from "./auth.types.js";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  let bearer: string | undefined = req.headers.authorization as string | undefined;
  if (!bearer) {
    const cookieHeader = req.headers.cookie;
    if (typeof cookieHeader === "string") {
      const pairs = cookieHeader.split(";").map((c) => c.trim());
      for (const p of pairs) {
        const idx = p.indexOf("=");
        if (idx === -1) continue;
        const name = p.slice(0, idx);
        const val = p.slice(idx + 1);
        if (name === "access_token") {
          bearer = `Bearer ${decodeURIComponent(val)}`;
          break;
        }
      }
    }
  }

  if (!bearer || !bearer.toString().toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing bearer token" } });
    return;
  }

  const token: string = bearer.slice("Bearer ".length).trim();
  const secret: string = process.env.JWT_SECRET ?? "";

  try {
    const payload = jwt.verify(token, secret) as AccessTokenPayload;
    if (payload.type !== "access") {
      res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Invalid token type" } });
      return;
    }
    req.user = payload;
    next();
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "TokenExpiredError") {
      res.status(401).json({ error: { code: "TOKEN_EXPIRED", message: "Token expired, please refresh" } });
      return;
    }
    res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Token is invalid" } });
  }
}
