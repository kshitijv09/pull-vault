import { Router } from "express";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { InventoryRepository } from "./inventory.repository";

const inventoryRepository = new InventoryRepository();
const inventoryService = new InventoryService(inventoryRepository);
const inventoryController = new InventoryController(inventoryService);

export const inventoryRouter = Router();

inventoryRouter.post("/bulk-upload", inventoryController.bulkUpload);
