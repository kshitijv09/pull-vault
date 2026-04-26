import { Request, Response } from "express";
import { InventoryService } from "./inventory.service";

export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  bulkUpload = async (req: Request, res: Response): Promise<void> => {
    try {
      const packs = req.body;
      if (!packs || !Array.isArray(packs)) {
         res.status(400).json({ error: "Invalid packs payload. Expected an array of packs." });
         return;
      }
      const createdPacks = await this.service.bulkUploadPacks(packs);
      res.status(201).json({ data: createdPacks });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };
}
