import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import type { AuthRequest } from "../../shared/middleware/authMiddleware";
import { PackFairnessRevealService } from "./packFairnessReveal.service";

export class PackFairnessRevealController {
  constructor(private readonly service: PackFairnessRevealService) {}

  /**
   * `GET /user-packs/:userPackId/fairness-reveal`
   *
   * REQ §B4 — "any user can check any past pack opening". Public for
   * consumed commits (after reveal, `server_secret` is no longer secret).
   * Pre-consumption the service still enforces owner-only access.
   */
  revealForUserPack = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const requesterUserId = req.user?.id ?? null;
      const data = await this.service.revealForUserPack(req.params.userPackId, requesterUserId);
      res.status(200).json({ data });
    } catch (error: unknown) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };

  /**
   * `GET /drops/:dropId/fairness-pool-snapshot`
   * Public verification artifact: ordered `(card_id, market_value_usd)` pool
   * pinned for this drop, plus its SHA-256 fingerprint.
   */
  getPoolSnapshot = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.getPoolSnapshot(req.params.dropId);
      res.status(200).json({ data });
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
