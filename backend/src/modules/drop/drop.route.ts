import { Router } from "express";
import { DropController } from "./drop.controller";
import { DropService } from "./drop.service";
import { DropRepository } from "./drop.repository";
import { PackFairnessCommitRepository } from "./packFairnessCommit.repository";
import { PackFairnessCommitService } from "./packFairnessCommit.service";
import { DropCardPoolSnapshotRepository } from "./dropCardPoolSnapshot.repository";
import { PackFairnessRevealController } from "./packFairnessReveal.controller";
import { PackFairnessRevealRepository } from "./packFairnessReveal.repository";
import { PackFairnessRevealService } from "./packFairnessReveal.service";
import { UserRepository } from "../user/user.repository";
import { ShardedRedisPackCounter } from "../../infra/redis/shardedRedisPackCounter";
import { authMiddleware } from "../../shared/middleware/authMiddleware";
import { dropPurchaseRateLimitMiddleware } from "../../shared/middleware/dropPurchaseRateLimitMiddleware";

const dropRepository = new DropRepository();
const packFairnessCommitRepository = new PackFairnessCommitRepository();
const packFairnessCommitService = new PackFairnessCommitService(dropRepository, packFairnessCommitRepository);
const userRepository = new UserRepository();
const packCounter = new ShardedRedisPackCounter();
const dropService = new DropService(dropRepository, userRepository, packCounter);
const dropController = new DropController(dropService, packFairnessCommitService);

const poolSnapshotRepository = new DropCardPoolSnapshotRepository();
const revealRepository = new PackFairnessRevealRepository();
const revealService = new PackFairnessRevealService(revealRepository, poolSnapshotRepository);
const revealController = new PackFairnessRevealController(revealService);

export const dropRouter = Router();

// Drop APIs
dropRouter.post("/", dropController.createDrop);
dropRouter.get("/", dropController.listDropsWithPacks);
dropRouter.get("/next", dropController.getNextDropState);
dropRouter.post("/:dropId/start-sale", dropController.seedLiveDropCounters);
dropRouter.post("/:dropId/end-sale", dropController.endDropSale);
/**
 * Provably fair Phase 1: commit server secret (return SHA-256 commitment) + client seed.
 * Optional body: `{ "client_seed": "..." }`. If omitted or empty, server generates `client_seed` (hex) and returns it.
 */
dropRouter.post("/:dropId/fairness-commit", authMiddleware, dropController.commitFairnessPhase1);

/**
 * Phase 3 verification artifact: ordered `(card_id, market_value_usd)` pool
 * pinned for this drop, plus the SHA-256 fingerprint a browser verifier uses
 * to recompute the Phase 2 derivation.
 */
dropRouter.get("/:dropId/fairness-pool-snapshot", revealController.getPoolSnapshot);

// Unified Pack / PackDrop APIs
dropRouter.get("/packs", dropController.listScheduledDrops); // replaces /pack-drops
dropRouter.post(
  "/packs/:dropId/purchase",
  authMiddleware,
  dropPurchaseRateLimitMiddleware,
  dropController.purchase
); // replaces /pack-drops/:dropId/purchase
dropRouter.get("/packs/:userId/available", dropController.listAvailableForUser); // replaces /packs/:userId/available
