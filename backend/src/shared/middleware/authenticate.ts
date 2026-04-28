import type { NextFunction, Request, Response } from "express";

function authenticate(req: Request, _res: Response, next: NextFunction): void {
  req.headers.authorization = req.headers.authorization ?? "";
  next();
}

export { authenticate };
