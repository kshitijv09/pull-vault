import { Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import type { AuthRequest } from "../../shared/middleware/authMiddleware";
import { DropService } from "./drop.service";
import { PackFairnessCommitService } from "./packFairnessCommit.service";

export class DropController {
  constructor(
    private readonly service: DropService,
    private readonly packFairnessCommitService: PackFairnessCommitService
  ) {}

  createDrop = async (req: Request, res: Response): Promise<void> => {
    try {
      const drop = await this.service.createDrop(req.body);
      res.status(201).json({ data: drop });
    } catch (error: any) {
      res.status(error?.statusCode || 500).json({ error: error?.message || "Internal Server Error" });
    }
  };

  listDropsWithPacks = async (_req: Request, res: Response): Promise<void> => {
    try {
      const drops = await this.service.listDropsWithPacks();
      res.status(200).json({ data: drops });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };

  listAvailableForUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const packs = await this.service.listAvailablePacksForUser(req.params.userId);
      res.status(200).json({ data: { packs } });
    } catch (error: any) {
      res.status(error?.statusCode || 500).json({ error: error?.message || "Internal Server Error" });
    }
  };

  listScheduledDrops = async (_req: Request, res: Response): Promise<void> => {
    try {
      const drops = await this.service.listScheduledDrops();
      res.status(200).json({ data: drops });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };

  seedLiveDropCounters = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.seedLiveDropCounters(req.params.dropId);
      res.status(200).json({ data });
    } catch (error: any) {
      res.status(error?.statusCode || 500).json({ error: error?.message || "Internal Server Error" });
    }
  };

  getNextDropState = async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.getNextDropState();
      res.status(200).json({ data });
    } catch (error: any) {
      res.status(error?.statusCode || 500).json({ error: error?.message || "Internal Server Error" });
    }
  };

  purchase = async (_req: Request, res: Response): Promise<void> => {
    // TODO: Validate body and call service.purchasePack.
    res.status(501).json({
      error: "Not Implemented"
    });
  };

  endDropSale = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.endDropSale(req.params.dropId);
      res.status(200).json({ data });
    } catch (error: any) {
      res.status(error?.statusCode || 500).json({ error: error?.message || "Internal Server Error" });
    }
  };

  /**
   * `POST /drops/:dropId/fairness-commit` (authenticated)
   * Body: `{ client_seed?: string }` — optional; if omitted or blank, server generates `client_seed` and returns it.
   * Returns: `nonce`, `server_commitment`, `client_seed`, `client_seed_source`.
   */
  commitFairnessPhase1 = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const data = await this.packFairnessCommitService.createCommit(userId, req.params.dropId, req.body);
      res.status(201).json({ data });
    } catch (error: unknown) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };
}
