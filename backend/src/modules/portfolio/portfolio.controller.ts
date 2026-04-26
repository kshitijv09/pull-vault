import type { Request, Response } from "express";
import type { AuthRequest } from "../../shared/middleware/authMiddleware";
import { PortfolioService } from "./portfolio.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PortfolioController {
  constructor(private readonly service: PortfolioService) {}

  private assertSelf(authReq: AuthRequest, userId: string): boolean {
    if (!authReq.user?.id || authReq.user.id !== userId) {
      return false;
    }
    return true;
  }

  getPortfolioValue = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const { userId } = req.params;
      if (!UUID.test(userId)) {
        res.status(400).json({ error: "Invalid user ID format." });
        return;
      }
      if (!this.assertSelf(authReq, userId)) {
        res.status(403).json({ error: "You can only view your own portfolio." });
        return;
      }
      const data = await this.service.getCurrentComputation(userId);
      res.status(200).json({ data });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };

  getPortfolioSnapshots = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const { userId } = req.params;
      if (!UUID.test(userId)) {
        res.status(400).json({ error: "Invalid user ID format." });
        return;
      }
      if (!this.assertSelf(authReq, userId)) {
        res.status(403).json({ error: "You can only view your own portfolio history." });
        return;
      }
      const range = this.service.parseRange(req.query.range);
      const points = await this.service.listSnapshots(userId, range);
      res.status(200).json({ data: { range, points } });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };

  postPortfolioSnapshot = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const { userId } = req.params;
      if (!UUID.test(userId)) {
        res.status(400).json({ error: "Invalid user ID format." });
        return;
      }
      if (!this.assertSelf(authReq, userId)) {
        res.status(403).json({ error: "You can only record snapshots for your own portfolio." });
        return;
      }
      const data = await this.service.recordSnapshotForUser(userId);
      res.status(201).json({ data });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };
}
