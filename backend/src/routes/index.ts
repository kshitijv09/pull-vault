import { Router } from "express";
import { healthRouter } from "./health.route";
import { userRouter } from "../modules/user/user.route";
import { inventoryRouter } from "../modules/inventory/inventory.route";
import { dropRouter } from "../modules/drop/drop.route";
import { packQueueRouter } from "../modules/pack-queue/packQueue.route";
import { marketplaceRouter } from "../modules/marketplace/marketplace.route";
import { auctionRouter } from "../modules/auction/auction.route";
import { packGeneratorRouter } from "../modules/pack-generator/packGenerator.route";
import { earningsAnalyticsRouter } from "../modules/analytics/earningsAnalytics.route";
import { tcgCatalogRouter } from "../modules/catalog/tcgCatalog.route";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/users", userRouter);
apiRouter.use("/marketplace", marketplaceRouter);
apiRouter.use("/auctions", auctionRouter);
apiRouter.use("/inventory", inventoryRouter);
apiRouter.use("/drops", dropRouter);
apiRouter.use("/pack-queue", packQueueRouter);
apiRouter.use("/pack-generator", packGeneratorRouter);
apiRouter.use("/analytics/earnings", earningsAnalyticsRouter);
apiRouter.use("/catalog", tcgCatalogRouter);

