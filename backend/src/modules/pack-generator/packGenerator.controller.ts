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
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };
}
