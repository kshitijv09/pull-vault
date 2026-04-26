import type { Request, Response } from "express";
import type { AuthRequest } from "../../shared/middleware/authMiddleware";
import { UserService } from "./user.service";

export class UserController {
  constructor(private readonly service: UserService) {}

  private isSelfRequest(req: Request): boolean {
    const authReq = req as AuthRequest;
    return Boolean(authReq.user?.id && authReq.user.id === req.params.userId);
  }

  signup = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = await this.service.signup({
        email: String(req.body.email ?? ""),
        fullName: String(req.body.fullName ?? ""),
        password: String(req.body.password ?? ""),
        passwordHash: "", // service will calculate this
        phone: this.optionalString(req.body.phone),
        city: this.optionalString(req.body.city),
        country: this.optionalString(req.body.country)
      });
      res.status(201).json({ data: user });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };

  login = async (req: Request, res: Response): Promise<void> => {
    try {
      
      const email = String(req.body.email ?? "");
      const password = String(req.body.password ?? "");
      const data = await this.service.login(email, password);
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

  getUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(req.params.userId)) {
        res.status(400).json({ error: "Invalid user ID format." });
        return;
      }
      if (!this.isSelfRequest(req)) {
        res.status(403).json({ error: "You can only view your own profile." });
        return;
      }
      const user = await this.service.getUser(req.params.userId);
      res.status(200).json({ data: user });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };

  getPublicProfiles = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user?.id) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }
      const rawIds = typeof req.query.ids === "string" ? req.query.ids : "";
      const ids = rawIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (ids.some((id) => !uuidRegex.test(id))) {
        res.status(400).json({ error: "All ids must be valid UUIDs." });
        return;
      }
      const data = await this.service.getPublicProfilesByIds(ids);
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

  depositFunds = async (req: Request, res: Response): Promise<void> => {
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(req.params.userId)) {
        res.status(400).json({ error: "Invalid user ID format." });
        return;
      }
      if (!this.isSelfRequest(req)) {
        res.status(403).json({ error: "You can only deposit funds into your own wallet." });
        return;
      }
      const user = await this.service.depositFunds({
        userId: req.params.userId,
        amount: String(req.body.amount ?? "")
      });
      res.status(200).json({ data: user });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };

  getUserCards = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(req.params.userId)) {
        res.status(400).json({ error: "Invalid user ID format." });
        return;
      }
      if (!authReq.user?.id || authReq.user.id !== req.params.userId) {
        res.status(403).json({ error: "You can only view your own collection." });
        return;
      }
      const filter = {
        rarity: this.optionalQueryString(req.query.rarity),
        cardSet: this.optionalQueryString(req.query.cardSet),
        name: this.optionalQueryString(req.query.name),
        collectionListing: this.optionalQueryString(req.query.collectionListing)
      };
      const cards = await this.service.getCards(req.params.userId, filter);
      res.status(200).json({ data: cards });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };

  getUserCardFacets = async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(req.params.userId)) {
        res.status(400).json({ error: "Invalid user ID format." });
        return;
      }
      if (!authReq.user?.id || authReq.user.id !== req.params.userId) {
        res.status(403).json({ error: "You can only view your own collection." });
        return;
      }
      const facets = await this.service.getOwnedCardFacets(req.params.userId);
      res.status(200).json({ data: facets });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  };

  private optionalQueryString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalizedValue = value.trim();
    return normalizedValue.length > 0 ? normalizedValue : undefined;
  }

  private optionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const normalizedValue = value.trim();
    return normalizedValue.length > 0 ? normalizedValue : undefined;
  }
}
