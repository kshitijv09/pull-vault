import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { PackGeneratorService } from "./packGenerator.service";

export class PackGeneratorController {
  constructor(private readonly service: PackGeneratorService) {}

  createPack = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.generatePackBatch(req.body);
      res.status(201).json({ data });
    } catch (error) {
      this.handleError(error, res);
    }
  };

  /**
   * `POST /pack-generator/packs/regenerate-cards`
   * Body: { pack_ids: string[] } — `packs.id` list; replaces `pack_card` using `StandardGenerationStrategy`.
   */
  regeneratePackCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.regeneratePackCardsByIds(req.body);
      res.status(200).json({ data });
    } catch (error) {
      this.handleError(error, res);
    }
  };

  /**
   * `POST /pack-generator/sync-catalog-prices`
   *
   * Runs upstream catalog price sync, then re-rolls `pack_card` for every eligible `packs` template
   * that contains a card whose price moved beyond the configured relative threshold (see `PriceSyncService`,
   * `findPackTemplateIdsEligibleForRegeneration`).
   */
  syncCatalogPrices = async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.syncCatalogPricesAndRegenerateEligiblePacks();
      res.status(200).json({ data });
    } catch (error) {
      this.handleError(error, res);
    }
  };

  /**
   * `POST /pack-generator/simulate`
   * Body: { tier_name, count (1–10000), dry_streak_initial? }
   *
   * Generates `count` packs from the DB catalog without persisting them, returning per-pack
   * economics (retail price, card value, diff) and aggregate stats
   * (margin, aggregate net profit/loss % on total card value, `packCounts`, distribution histogram,
   * acceptance criteria).
   */
  simulate = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.service.simulatePacks(req.body);
      res.status(200).json({ data });
    } catch (error) {
      this.handleError(error, res);
    }
  };

  private handleError(error: unknown, res: Response): void {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
