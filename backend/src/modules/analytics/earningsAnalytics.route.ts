import { Router } from "express";
import { EarningsAnalyticsController } from "./earningsAnalytics.controller";
import { EarningsAnalyticsRepository } from "./earningsAnalytics.repository";
import { EarningsAnalyticsService } from "./earningsAnalytics.service";

const repository = new EarningsAnalyticsRepository();
const service = new EarningsAnalyticsService(repository);
const controller = new EarningsAnalyticsController(service);

export const earningsAnalyticsRouter = Router();

/**
 * Dashboard-friendly earnings analytics APIs.
 */
earningsAnalyticsRouter.get("/overview", controller.getOverview);
earningsAnalyticsRouter.get("/timeseries", controller.getTimeseries);
earningsAnalyticsRouter.get("/events", controller.listEvents);
