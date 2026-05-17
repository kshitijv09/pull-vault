import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import type { AuthRequest } from "../../shared/middleware/authMiddleware";
import { logPlatformHealthError } from "./platformHealth.log";
import { PlatformHealthService } from "./platformHealth.service";
import type { PlatformHealthRangePreset } from "./platformHealth.types";

const ALLOWED_PRESETS: PlatformHealthRangePreset[] = ["24h", "7d", "30d", "90d", "ytd", "all"];
const ALLOWED_VERIFY_RESULTS = new Set(["pass", "fail"]);
/**
 * Whitelist matches the check IDs emitted by `frontend/src/lib/fairness/verifier.ts`.
 * Keep this in sync with that file — controller validates here so the audit
 * table only ever stores expected values (powers the alert key
 * `verifier_failures` in `platformHealth.service.ts`).
 */
const ALLOWED_VERIFY_FAILING_CHECKS = new Set([
  "server_commitment",
  "pool_fingerprint_transcript",
  "pool_fingerprint_recomputed",
  "algorithm_supported",
  "card_replay"
]);

export class PlatformHealthController {
  constructor(private readonly service: PlatformHealthService) {}

  getSummary = async (req: Request, res: Response): Promise<void> => {
    const range = this.parsePreset(req.query.range);
    const from = this.optionalString(req.query.from);
    const to = this.optionalString(req.query.to);
    try {
      const result = await this.service.getSummary({ from, to, range });
      res.status(200).json({ data: result });
    } catch (error) {
      this.handleError(error, res, {
        operation: "getSummary",
        range: range ?? null,
        fromIso: from ?? null,
        toIso: to ?? null
      });
    }
  };

  getOpenAlerts = async (_req: Request, res: Response): Promise<void> => {
    try {
      const alerts = await this.service.listOpenAlerts();
      res.status(200).json({ data: { alerts } });
    } catch (error) {
      this.handleError(error, res, { operation: "getOpenAlerts" });
    }
  };

  recordVerifyEvent = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userPackId = String(req.params.userPackId ?? "").trim();
      if (!userPackId) {
        throw new AppError("userPackId is required.", 400);
      }
      const body = req.body ?? {};
      const result = body.result;
      if (!ALLOWED_VERIFY_RESULTS.has(result)) {
        throw new AppError("result must be 'pass' or 'fail'.", 400);
      }
      const failingCheck = result === "fail" ? String(body.failingCheck ?? "").trim() : null;
      if (failingCheck && !ALLOWED_VERIFY_FAILING_CHECKS.has(failingCheck)) {
        throw new AppError(`Unsupported failingCheck '${failingCheck}'.`, 400);
      }
      await this.service.logVerifyEvent({
        userPackId,
        verifierUserId: req.user?.id ?? null,
        verifierIp: normaliseIp(req),
        result,
        failingCheck: failingCheck || null
      });
      res.status(204).end();
    } catch (error) {
      this.handleError(error, res, {
        operation: "recordVerifyEvent",
        userPackId: String(req.params.userPackId ?? "")
      });
    }
  };

  simulateMarginDrop = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      const tierName = String(body.tierName ?? "").trim();
      const packs = Number(body.packs);
      const marginGapPp = Number(body.marginGapPp);
      if (!tierName) throw new AppError("tierName is required.", 400);
      if (!Number.isFinite(packs)) throw new AppError("packs must be a number.", 400);
      if (!Number.isFinite(marginGapPp)) throw new AppError("marginGapPp must be a number.", 400);
      const result = await this.service.simulateMarginDrop({ tierName, packs, marginGapPp });
      res.status(200).json({ data: result });
    } catch (error) {
      this.handleError(error, res, {
        operation: "simulateMarginDrop",
        tierName: String((req.body ?? {}).tierName ?? "")
      });
    }
  };

  private parsePreset(value: unknown): PlatformHealthRangePreset | undefined {
    const raw = this.optionalString(value);
    if (!raw) return undefined;
    if (!ALLOWED_PRESETS.includes(raw as PlatformHealthRangePreset)) {
      throw new AppError(`Invalid range preset '${raw}'.`, 400);
    }
    return raw as PlatformHealthRangePreset;
  }

  private optionalString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }

  private handleError(
    error: unknown,
    res: Response,
    context: Parameters<typeof logPlatformHealthError>[0]
  ): void {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logPlatformHealthError(context, error);
    res.status(500).json({ error: "Internal server error" });
  }
}

function normaliseIp(req: AuthRequest): string | null {
  const xff = req.headers["x-forwarded-for"];
  const forwarded =
    typeof xff === "string"
      ? xff.split(",")[0]?.trim()
      : Array.isArray(xff)
        ? xff[0]?.split(",")[0]?.trim()
        : "";
  const direct = typeof req.ip === "string" ? req.ip.trim() : "";
  const ip = forwarded || direct;
  return ip ? ip.replace(/:/g, "_") : null;
}
