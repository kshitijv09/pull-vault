import { Router } from "express";
import { authMiddleware } from "../../shared/middleware/authMiddleware";
import { AuctionController } from "./auction.controller";
import { AuctionRepository } from "./auction.repository";
import { AuctionService } from "./auction.service";

const repository = new AuctionRepository();
const service = new AuctionService(repository);
const controller = new AuctionController(service);

export const auctionRouter = Router();

auctionRouter.get("/listings", controller.getAuctions);
auctionRouter.get("/slots", controller.getSlots);
auctionRouter.post("/slots", authMiddleware, controller.createSlot);
auctionRouter.post("/slots/:slotId/listings", authMiddleware, controller.addSlotListing);
auctionRouter.post("/:auctionId/start", authMiddleware, controller.startAuction);
auctionRouter.post("/:auctionId/bids/init", authMiddleware, controller.initBidSession);
auctionRouter.post("/:auctionId/bids/restore", authMiddleware, controller.restoreOutbidWallet);
auctionRouter.post("/:auctionId/bids", authMiddleware, controller.placeBid);
