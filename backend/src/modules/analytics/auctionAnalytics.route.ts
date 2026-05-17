import { Router } from "express";
import { AuctionAnalyticsController } from "./auctionAnalytics.controller";
import { AuctionAnalyticsRepository } from "./auctionAnalytics.repository";
import { AuctionAnalyticsService } from "./auctionAnalytics.service";

const repository = new AuctionAnalyticsRepository();
const service = new AuctionAnalyticsService(repository);
const controller = new AuctionAnalyticsController(service);

export const auctionAnalyticsRouter = Router();

auctionAnalyticsRouter.get("/summary", controller.getSummary);
auctionAnalyticsRouter.get("/timeseries", controller.getTimeseries);
