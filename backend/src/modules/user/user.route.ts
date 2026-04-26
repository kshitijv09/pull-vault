import { Router } from "express";
import { UserController } from "./user.controller";
import { UserRepository } from "./user.repository";
import { UserService } from "./user.service";
import { DropController } from "../drop/drop.controller";
import { DropService } from "../drop/drop.service";
import { DropRepository } from "../drop/drop.repository";
import { ShardedRedisPackCounter } from "../../infra/redis/shardedRedisPackCounter";

import { authMiddleware } from "../../shared/middleware/authMiddleware";
import { portfolioRouter } from "../portfolio/portfolio.route";
import { MarketplaceRepository } from "../marketplace/marketplace.repository";
import { MarketplaceService } from "../marketplace/marketplace.service";
import { MarketplaceController } from "../marketplace/marketplace.controller";

const userRepository = new UserRepository();
const dropRepository = new DropRepository();
const packCounter = new ShardedRedisPackCounter();
const dropService = new DropService(dropRepository, userRepository, packCounter);
const dropController = new DropController(dropService);
const userService = new UserService(userRepository);
const userController = new UserController(userService);

const marketplaceRepository = new MarketplaceRepository();
const marketplaceService = new MarketplaceService(marketplaceRepository);
const marketplaceController = new MarketplaceController(marketplaceService);

export const userRouter = Router();

userRouter.post("/signup", userController.signup);
userRouter.post("/login", userController.login);

// Protected routes
userRouter.get("/:userId/packs", authMiddleware, dropController.listAvailableForUser);
userRouter.get("/public/profiles", authMiddleware, userController.getPublicProfiles);
userRouter.get("/:userId/cards/facets", authMiddleware, userController.getUserCardFacets);
userRouter.get("/:userId/cards", authMiddleware, userController.getUserCards);
userRouter.post(
  "/:userId/cards/:userCardId/list-for-sale",
  authMiddleware,
  marketplaceController.listCardForSale
);
userRouter.post("/:userId/cards/:userCardId/unlist", authMiddleware, marketplaceController.unlistCard);
userRouter.use("/:userId/portfolio", portfolioRouter);
userRouter.get("/:userId", authMiddleware, userController.getUser);
userRouter.post("/:userId/wallet/deposit", authMiddleware, userController.depositFunds);

