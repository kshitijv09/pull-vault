import { Router } from "express";
import { authMiddleware } from "../../shared/middleware/authMiddleware";
import { PortfolioRepository } from "./portfolio.repository";
import { PortfolioService } from "./portfolio.service";
import { PortfolioController } from "./portfolio.controller";

const portfolioRepository = new PortfolioRepository();
const portfolioService = new PortfolioService(portfolioRepository);
const portfolioController = new PortfolioController(portfolioService);

/** Mounted at `/users/:userId/portfolio` — use `mergeParams` so `userId` is available. */
export const portfolioRouter = Router({ mergeParams: true });

portfolioRouter.get("/value", authMiddleware, portfolioController.getPortfolioValue);
portfolioRouter.get("/snapshots", authMiddleware, portfolioController.getPortfolioSnapshots);
portfolioRouter.post("/snapshot", authMiddleware, portfolioController.postPortfolioSnapshot);
