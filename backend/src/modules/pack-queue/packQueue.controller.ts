import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { PackQueueService } from "./packQueue.service";

export class PackQueueController {
  constructor(private readonly service: PackQueueService) {}

  enqueuePackPurchase = async (req: Request, res: Response): Promise<void> => {
    try {
      const userIdHeader = typeof req.headers["x-user-id"] === "string" ? req.headers["x-user-id"] : "";
      const result = await this.service.enqueuePackPurchase(req.body, userIdHeader);
      res.status(202).json({ data: result });
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
