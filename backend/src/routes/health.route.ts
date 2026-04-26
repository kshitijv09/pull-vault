import { Router } from "express";
import { query } from "../db";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  await query("SELECT 1");
  res.status(200).json({ status: "ok" });
});
