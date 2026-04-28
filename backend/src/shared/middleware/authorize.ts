import type { NextFunction, Request, Response } from "express";

function authorize(_roles: string[]) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}

export { authorize };
