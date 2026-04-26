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
 * Body: { tier_name, strategy_name, count }
 */
packGeneratorRouter.post("/packs", controller.createPack);
