import type { Request, Response } from "express";
import type { AuthRequest } from "../../shared/middleware/authMiddleware";
import { MarketplaceService } from "./marketplace.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MarketplaceController {
  constructor(private readonly service: MarketplaceService) {}

  getListings = async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.getListings();
      res.status(200).json({ data });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };

  browseListings = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const viewerId = authReq.user?.id?.trim() ?? "";
      if (!viewerId) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }
      const data = await this.service.getBrowseListingsForViewer(viewerId);
      res.status(200).json({ data });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };

  purchase = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const buyerId = authReq.user?.id?.trim() ?? "";
      if (!buyerId) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }
      const userCardId = typeof req.body?.userCardId === "string" ? req.body.userCardId.trim() : "";
      if (!UUID.test(userCardId)) {
        res.status(400).json({ error: "Body userCardId must be a valid UUID." });
        return;
      }
      const data = await this.service.purchaseCard(buyerId, userCardId);
      res.status(200).json({ data });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };

  listCardForSale = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const { userId, userCardId } = req.params;
      if (!UUID.test(userId) || !UUID.test(userCardId)) {
        res.status(400).json({ error: "Invalid id format." });
        return;
      }
      if (!authReq.user?.id || authReq.user.id !== userId) {
        res.status(403).json({ error: "You can only list cards from your own collection." });
        return;
      }
      const listingPriceUsd =
        typeof req.body?.listingPriceUsd === "string" || typeof req.body?.listingPriceUsd === "number"
          ? String(req.body.listingPriceUsd)
          : "";
      if (!listingPriceUsd.trim()) {
        res.status(400).json({ error: "Body listingPriceUsd is required." });
        return;
      }
      const result = await this.service.listCardForSale(userId, userCardId, listingPriceUsd);
      res.status(200).json({ data: { listed: true, userCardId, listingPriceUsd: result.listingPriceUsd } });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };

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
      await this.service.goLiveForAuction(userId, userCardId);
      res.status(200).json({ data: { sellingStatus: "listed_for_auction", userCardId } });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };

  unlistCard = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const { userId, userCardId } = req.params;
      if (!UUID.test(userId) || !UUID.test(userCardId)) {
        res.status(400).json({ error: "Invalid id format." });
        return;
      }
      if (!authReq.user?.id || authReq.user.id !== userId) {
        res.status(403).json({ error: "You can only change listings for your own collection." });
        return;
      }
      await this.service.unlistCard(userId, userCardId);
      res.status(200).json({ data: { listed: false, userCardId } });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };
}
