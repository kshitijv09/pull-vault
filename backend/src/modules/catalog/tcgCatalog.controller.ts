import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { TcgCatalogService } from "./tcgCatalog.service";
import type { TcgSearchImportRequestBody } from "./tcgCatalog.types";

export class TcgCatalogController {
  constructor(private readonly service: TcgCatalogService) {}

  importFromTcgSearch = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as TcgSearchImportRequestBody;
      const data = await this.service.importFromSearch(body);
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
