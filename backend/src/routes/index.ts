import { Router } from "express";
import { healthRouter } from "./health.route";
import { userRouter } from "../modules/user/user.route";
import { inventoryRouter } from "../modules/inventory/inventory.route";
import { dropRouter } from "../modules/drop/drop.route";
import { packQueueRouter } from "../modules/pack-queue/packQueue.route";
import { marketplaceRouter } from "../modules/marketplace/marketplace.route";
import { auctionRouter } from "../modules/auction/auction.route";
import { packGeneratorRouter } from "../modules/pack-generator/packGenerator.route";
import { auctionAnalyticsRouter } from "../modules/analytics/auctionAnalytics.route";
import { earningsAnalyticsRouter } from "../modules/analytics/earningsAnalytics.route";
import { platformHealthRouter } from "../modules/analytics/platformHealth.route";
import { tcgCatalogRouter } from "../modules/catalog/tcgCatalog.route";
import { userPackRouter } from "../modules/user-pack/userPack.route";

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
apiRouter.use("/analytics/auctions", auctionAnalyticsRouter);
apiRouter.use("/analytics/health", platformHealthRouter);
apiRouter.use("/catalog", tcgCatalogRouter);
apiRouter.use("/user-packs", userPackRouter);

