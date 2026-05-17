import { Router } from "express";
import { authMiddleware, optionalAuthMiddleware } from "../../shared/middleware/authMiddleware";
import { AuctionAnalyticsRepository } from "./auctionAnalytics.repository";
import { PlatformHealthController } from "./platformHealth.controller";
import { PlatformHealthRepository } from "./platformHealth.repository";
import { PlatformHealthService } from "./platformHealth.service";

const platformRepo = new PlatformHealthRepository();
const auctionRepo = new AuctionAnalyticsRepository();
const service = new PlatformHealthService(platformRepo, auctionRepo);
const controller = new PlatformHealthController(service);

export const platformHealthRouter = Router();

platformHealthRouter.get("/summary", authMiddleware, controller.getSummary);
platformHealthRouter.get("/alerts/open", authMiddleware, controller.getOpenAlerts);

/**
 * Admin-ish demo hook: synthesises pack_purchase ledger rows so the next
 * economics panel poll shows a degraded margin. Sits behind `authMiddleware`
 * (the codebase has no role middleware yet) — we should layer real RBAC
 * before exposing this beyond engineering.
 */
platformHealthRouter.post(
  "/economics/simulate-margin-drop",
  authMiddleware,
  controller.simulateMarginDrop
);

/**
 * `mergeParams` so this sub-router inherits `:userPackId` from the parent
 * userPack router when mounted under `/user-packs/:userPackId`.
 */
export const platformHealthVerifyRouter = Router({ mergeParams: true });

/**
 * Verifier beacon. Pinged by the FE after the browser-only verifier finishes.
 * `optionalAuthMiddleware` so anonymous verifiers (REQ §B4) still get logged
 * without a 401, but if a Bearer is present we attribute the event.
 */
platformHealthVerifyRouter.post(
  "/fairness-verify-event",
  optionalAuthMiddleware,
  controller.recordVerifyEvent
);

export { service as platformHealthService };
