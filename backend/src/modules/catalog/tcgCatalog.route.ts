import { Router } from "express";
import { TcgCatalogController } from "./tcgCatalog.controller";
import { TcgCatalogRepository } from "./tcgCatalog.repository";
import { TcgCatalogService } from "./tcgCatalog.service";

const repository = new TcgCatalogRepository();
const service = new TcgCatalogService(repository);
const controller = new TcgCatalogController(service);

export const tcgCatalogRouter = Router();

/**
 * Calls justtcg Pokemon cards feeds (`game=pokemon`, `game=pokemon-japan`), then inserts
 * one `card` row per new external id (existing rows are left unchanged).
 * Body currently ignored.
 */
tcgCatalogRouter.post("/tcg-search-import", controller.importFromTcgSearch);
