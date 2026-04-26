import { Router } from "express";
import { TcgCatalogController } from "./tcgCatalog.controller";
import { TcgCatalogRepository } from "./tcgCatalog.repository";
import { TcgCatalogService } from "./tcgCatalog.service";

const repository = new TcgCatalogRepository();
const service = new TcgCatalogService(repository);
const controller = new TcgCatalogController(service);

export const tcgCatalogRouter = Router();

/**
 * Calls justtcg Pokemon cards feed, then upserts one `card` row per unique external id.
 * Body currently ignored; endpoint imports from:
 * https://api.justtcg.com/v1/cards?game=pokemon
 */
tcgCatalogRouter.post("/tcg-search-import", controller.importFromTcgSearch);
