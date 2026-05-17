import { Router } from "express";
import { PackGeneratorController } from "./packGenerator.controller";
import { PackGeneratorRepository } from "./packGenerator.repository";
import { PackGeneratorService } from "./packGenerator.service";
import { PriceSyncService } from "./priceSync.service";

const repository = new PackGeneratorRepository();
const priceSyncService = new PriceSyncService();
const service = new PackGeneratorService(repository, priceSyncService);
const controller = new PackGeneratorController(service);

export const packGeneratorRouter = Router();

/**
 * Creates one or many generated packs from tier + strategy parameters.
 * `tier_name` selects retail price / target pack value only; the full catalog is eligible for every tier.
 * Body: { tier_name, strategy_name, count, dry_streak_initial? }
 */
packGeneratorRouter.post("/packs", controller.createPack);

/**
 * Re-assigns cards for existing `packs` templates: deletes `pack_card` for each id and inserts
 * a fresh `StandardGenerationStrategy` build (DB catalog, same rules as batch generator).
 * Body: { pack_ids: string[] } (max 100, no duplicates). All-or-nothing transaction.
 */
packGeneratorRouter.post("/packs/regenerate-cards", controller.regeneratePackCards);

/**
 * Fetches latest card prices, updates `card.market_value_usd`, then regenerates `pack_card` for each
 * eligible `packs` template tied to a materially changed card (excludes `reserved` inventory and
 * `in_drop_sale` on **`live`** drops).
 */
packGeneratorRouter.post("/sync-catalog-prices", controller.syncCatalogPrices);

/**
 * Simulation / testing endpoint (no pack writes). Card pool and prices come from the `card` catalog table.
 * Body: { tier_name, count (1–10000), dry_streak_initial? }
 *
 * Returns per-pack breakdown:
 *   - retailPriceUsd  — pack sticker price
 *   - realisedValueUsd — sum of card market values
 *   - diffVsRetailUsd  — realisedValue − retailPrice (neg = house profit on this pack)
 *   - diffVsTpvUsd     — realisedValue − TPV
 *   - isWin            — realisedValue ≥ retailPrice
 *
 * Plus aggregate: margin, winRate, **`results.netProfitLossPctOnCardValue`** — `(total retail − total
 * realised) / total realised` (positive = company gains vs card value; negative = consumers ahead),
 * **`aggregateTotalRetailUsd`** / **`aggregateTotalRealisedValueUsd`**, `results.packCounts` (byBranch /
 * byOutcome), distribution histogram, acceptance criteria (see `architecture/pack-economics.md`).
 */
packGeneratorRouter.post("/simulate", controller.simulate);
