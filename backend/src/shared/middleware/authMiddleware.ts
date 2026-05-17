import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { AppError } from "../errors/AppError";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new AppError("Authentication token is missing or invalid", 401));
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { id: string; email: string };
    req.user = payload;
    next();
  } catch (error) {
    return next(new AppError("Invalid or expired authentication token", 401));
  }
}

/**
 * Best-effort auth: populates `req.user` if a valid Bearer token is present,
 * but never rejects unauthenticated requests. Used by endpoints (e.g. the
 * provably-fair reveal) that are public after a precondition is met but
 * still want the user identity for pre-condition gates.
 */
export function optionalAuthMiddleware(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { id: string; email: string };
    req.user = payload;
  } catch {
    // Silently ignore invalid tokens for optional auth; treat as anonymous.
  }
  next();
}
