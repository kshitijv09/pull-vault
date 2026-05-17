import { Router } from "express";
import { optionalAuthMiddleware } from "../../shared/middleware/authMiddleware";
import { platformHealthVerifyRouter } from "../analytics/platformHealth.route";
import { DropCardPoolSnapshotRepository } from "../drop/dropCardPoolSnapshot.repository";
import { PackFairnessRevealController } from "../drop/packFairnessReveal.controller";
import { PackFairnessRevealRepository } from "../drop/packFairnessReveal.repository";
import { PackFairnessRevealService } from "../drop/packFairnessReveal.service";

const revealRepository = new PackFairnessRevealRepository();
const poolSnapshotRepository = new DropCardPoolSnapshotRepository();
const revealService = new PackFairnessRevealService(revealRepository, poolSnapshotRepository);
const revealController = new PackFairnessRevealController(revealService);

export const userPackRouter = Router();

/**
 * Phase 3 provably-fair reveal: returns Phase 1 commitment, the now-revealed
 * `server_secret`, the canonical transcript, the outcome cards, and a pointer
 * to the per-drop pool snapshot needed by the browser verifier.
 *
 * Public for consumed commits (REQ §B4 — "any user can check any past pack
 * opening"); falls back to owner-only when the commit is still in-flight.
 */
userPackRouter.get(
  "/:userPackId/fairness-reveal",
  optionalAuthMiddleware,
  revealController.revealForUserPack
);

/**
 * Phase 4 verifier beacon: browser pings here after the in-page verifier
 * finishes so the B5 fairness-audit panel can report "how many users used
 * the verification" (REQ §B5). Anonymous-OK; routed under user-packs so the
 * `:userPackId` lookup matches the reveal endpoint.
 */
userPackRouter.use("/:userPackId", platformHealthVerifyRouter);
