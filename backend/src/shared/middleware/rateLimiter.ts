import type { Request, Response, NextFunction } from "express";

type Entry = { count: number; resetAt: number };
const attempts: Map<string, Entry> = new Map<string, Entry>();

export function rateLimitLogin(req: Request, res: Response, next: NextFunction): void {
  const key: string = req.ip || "unknown";
  const now: number = Date.now();
  const existing: Entry | undefined = attempts.get(key);

  if (!existing || existing.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }

  if (existing.count >= 5) {
    res.status(429).json({ error: { code: "TOO_MANY_ATTEMPTS", message: "Too many login attempts. Try again later." } });
    return;
  }

  existing.count += 1;
  attempts.set(key, existing);
  next();
}
