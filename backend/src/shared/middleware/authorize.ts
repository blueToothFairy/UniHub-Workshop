import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "../../modules/auth/auth.types.js";

export function authorize(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole: UserRole | undefined = req.user?.role;
    if (!userRole || !roles.includes(userRole)) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not have permission" } });
      return;
    }
    next();
  };
}
