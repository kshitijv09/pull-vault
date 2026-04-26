import { Router } from "express";
import { DropController } from "./drop.controller";
import { DropService } from "./drop.service";
import { DropRepository } from "./drop.repository";
import { UserRepository } from "../user/user.repository";
import { ShardedRedisPackCounter } from "../../infra/redis/shardedRedisPackCounter";

const dropRepository = new DropRepository();
const userRepository = new UserRepository();
const packCounter = new ShardedRedisPackCounter();
const dropService = new DropService(dropRepository, userRepository, packCounter);
const dropController = new DropController(dropService);

export const dropRouter = Router();

// Drop APIs
dropRouter.post("/", dropController.createDrop);
dropRouter.get("/", dropController.listDropsWithPacks);
dropRouter.get("/next", dropController.getNextDropState);
dropRouter.post("/:dropId/start-sale", dropController.seedLiveDropCounters);
dropRouter.post("/:dropId/end-sale", dropController.endDropSale);

// Unified Pack / PackDrop APIs
dropRouter.get("/packs", dropController.listScheduledDrops); // replaces /pack-drops
dropRouter.post("/packs/:dropId/purchase", dropController.purchase); // replaces /pack-drops/:dropId/purchase
dropRouter.get("/packs/:userId/available", dropController.listAvailableForUser); // replaces /packs/:userId/available
