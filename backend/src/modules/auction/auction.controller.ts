import type { Request, Response } from "express";
import type { AuthRequest } from "../../shared/middleware/authMiddleware";
import { AppError } from "../../shared/errors/AppError";
import { AuctionService } from "./auction.service";
import type { AuctionListingStatus, AuctionSlotStatus } from "./auction.types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuctionController {
  constructor(private readonly service: AuctionService) {}

  private handleError(res: Response, error: unknown): void {
    const maybeErr = error as { statusCode?: number; message?: string; code?: string; details?: unknown } | undefined;
    const statusCode = maybeErr?.statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 600) {
      res.status(statusCode).json({
        error: typeof maybeErr?.message === "string" && maybeErr.message.trim() ? maybeErr.message : "Request failed.",
        code: typeof maybeErr?.code === "string" && maybeErr.code.trim() ? maybeErr.code : undefined,
        details: maybeErr?.details
      });
      return;
    }

    console.error(error);
    res.status(500).json({
      error: "Internal Server Error",
      code: "INTERNAL_SERVER_ERROR",
      details: maybeErr instanceof Error ? maybeErr.message : undefined
    });
  }

  getSlots = async (req: Request, res: Response): Promise<void> => {
    try {
      const slotStatus = typeof req.query.slotStatus === "string" ? req.query.slotStatus : undefined;
      const data = await this.service.getSlots(slotStatus);
      res.status(200).json({ data });
    } catch (error: any) {
      this.handleError(res, error);
    }
  };

  getAuctions = async (req: Request, res: Response): Promise<void> => {
    try {
      const slotId = typeof req.query.slotId === "string" ? req.query.slotId.trim() : undefined;
      const slotStatus = this.parseSlotStatus(req.query.slotStatus);
      const listingStatus = this.parseListingStatus(req.query.listingStatus);
      if (slotId && !UUID.test(slotId)) {
        res.status(400).json({ error: "Invalid slot id format." });
        return;
      }

      const data = await this.service.getAuctions({
        slotId,
        slotStatus,
        listingStatus
      });
      res.status(200).json({ data });
    } catch (error: any) {
      this.handleError(res, error);
    }
  };

  private parseSlotStatus(value: unknown): AuctionSlotStatus | undefined {
    if (typeof value !== "string" || !value.trim()) {
      return undefined;
    }
    const v = value.trim();
    if (v !== "scheduled" && v !== "active" && v !== "completed" && v !== "cancelled") {
      throw new AppError("slotStatus must be one of: scheduled, active, completed, cancelled.", 400);
    }
    return v;
  }

  private parseListingStatus(value: unknown): AuctionListingStatus | undefined {
    if (typeof value !== "string" || !value.trim()) {
      return undefined;
    }
    const v = value.trim();
    if (v !== "pending" && v !== "live" && v !== "sold" && v !== "unsold") {
      throw new AppError("listingStatus must be one of: pending, live, sold, unsold.", 400);
    }
    return v;
  }

  goLiveForAuction = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const { userId, userCardId } = req.params;
      if (!UUID.test(userId) || !UUID.test(userCardId)) {
        res.status(400).json({ error: "Invalid id format." });
        return;
      }
      if (!authReq.user?.id || authReq.user.id !== userId) {
        res.status(403).json({ error: "You can only update cards in your own collection." });
        return;
      }

      const startBidUsd =
        typeof req.body?.startBidUsd === "string" || typeof req.body?.startBidUsd === "number"
          ? String(req.body.startBidUsd)
          : undefined;
      const reservePriceUsd =
        typeof req.body?.reservePriceUsd === "string" || typeof req.body?.reservePriceUsd === "number"
          ? String(req.body.reservePriceUsd)
          : undefined;

      const data = await this.service.goLiveForAuction(userId, userCardId, startBidUsd, reservePriceUsd);
      res.status(200).json({ data });
    } catch (error: any) {
      this.handleError(res, error);
    }
  };

  startAuction = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const auctionSlotId =
        typeof req.params.slotId === "string" && req.params.slotId.trim()
          ? req.params.slotId.trim()
          : typeof req.params.auctionId === "string"
            ? req.params.auctionId.trim()
            : "";
      const requesterId = authReq.user?.id?.trim() ?? "";
      if (!UUID.test(auctionSlotId)) {
        res.status(400).json({ error: "Invalid auction slot id format." });
        return;
      }
      if (!UUID.test(requesterId)) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }

      const data = await this.service.startAuction(auctionSlotId, requesterId);
      res.status(200).json({ data });
    } catch (error: any) {
      this.handleError(res, error);
    }
  };

  initBidSession = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const auctionId = req.params.auctionId;
      const bidderId = authReq.user?.id?.trim() ?? "";
      if (!UUID.test(auctionId)) {
        res.status(400).json({ error: "Invalid auction id format." });
        return;
      }
      if (!UUID.test(bidderId)) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }

      const data = await this.service.initBidSession(auctionId, bidderId);
      res.status(200).json({ data });
    } catch (error: any) {
      this.handleError(res, error);
    }
  };

  restoreOutbidWallet = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const auctionId = req.params.auctionId;
      const bidderId = authReq.user?.id?.trim() ?? "";
      const amountUsd =
        typeof req.body?.amountUsd === "string" || typeof req.body?.amountUsd === "number"
          ? String(req.body.amountUsd)
          : "";
      if (!UUID.test(auctionId)) {
        res.status(400).json({ error: "Invalid auction id format." });
        return;
      }
      if (!UUID.test(bidderId)) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }
      if (!amountUsd.trim()) {
        res.status(400).json({ error: "Body amountUsd is required." });
        return;
      }

      const walletBalanceUsd = await this.service.restoreOutbidWallet(auctionId, bidderId, amountUsd);
      res.status(200).json({ data: { auctionListingId: auctionId, walletBalanceUsd } });
    } catch (error: any) {
      this.handleError(res, error);
    }
  };

  placeBid = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const auctionId = req.params.auctionId;
      const bidderId = authReq.user?.id?.trim() ?? "";
      const biddingPriceUsd =
        typeof req.body?.biddingPriceUsd === "string" || typeof req.body?.biddingPriceUsd === "number"
          ? String(req.body.biddingPriceUsd)
          : "";

      if (!UUID.test(auctionId)) {
        res.status(400).json({ error: "Invalid auction id format." });
        return;
      }
      if (!UUID.test(bidderId)) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }
      if (!biddingPriceUsd.trim()) {
        res.status(400).json({ error: "Body biddingPriceUsd is required." });
        return;
      }

      const data = await this.service.placeBid(auctionId, bidderId, biddingPriceUsd);
      res.status(200).json({ data });
    } catch (error: any) {
      this.handleError(res, error);
    }
  };

  addSlotListing = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const slotId = typeof req.params.slotId === "string" ? req.params.slotId.trim() : "";
      const userId = authReq.user?.id?.trim() ?? "";
      if (!UUID.test(slotId)) {
        res.status(400).json({ error: "Invalid slot id format." });
        return;
      }
      if (!UUID.test(userId)) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }
      const userCardId = typeof req.body?.userCardId === "string" ? req.body.userCardId.trim() : "";
      const startBidUsd =
        typeof req.body?.startBidUsd === "string" || typeof req.body?.startBidUsd === "number"
          ? String(req.body.startBidUsd)
          : "";
      const reservePriceUsd =
        typeof req.body?.reservePriceUsd === "string" || typeof req.body?.reservePriceUsd === "number"
          ? String(req.body.reservePriceUsd)
          : undefined;

      if (!UUID.test(userCardId)) {
        res.status(400).json({ error: "Body userCardId must be a valid UUID." });
        return;
      }
      if (!startBidUsd.trim()) {
        res.status(400).json({ error: "Body startBidUsd is required." });
        return;
      }

      const data = await this.service.addUserListingToSlot(slotId, userId, userCardId, startBidUsd, reservePriceUsd);
      res.status(200).json({ data });
    } catch (error: any) {
      this.handleError(res, error);
    }
  };

  createSlot = async (req: Request, res: Response): Promise<void> => {
    try {
      const { start_time, capacity, duration, name } = req.body;
      const data = await this.service.createSlot(
        typeof start_time === "string" ? start_time : undefined,
        typeof capacity === "number" ? capacity : undefined,
        typeof duration === "number" ? duration : undefined,
        typeof name === "string" ? name : undefined
      );
      res.status(201).json({ data });
    } catch (error: any) {
      this.handleError(res, error);
    }
  };
}
