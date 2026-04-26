import { Router } from "express";
import { authMiddleware } from "../../shared/middleware/authMiddleware";
import { MarketplaceRepository } from "./marketplace.repository";
import { MarketplaceService } from "./marketplace.service";
import { MarketplaceController } from "./marketplace.controller";

const repository = new MarketplaceRepository();
const service = new MarketplaceService(repository);
const controller = new MarketplaceController(service);

export const marketplaceRouter = Router();

marketplaceRouter.get("/listings", controller.getListings);
marketplaceRouter.get("/browse", authMiddleware, controller.browseListings);
marketplaceRouter.post("/purchase", authMiddleware, controller.purchase);
