import Decimal from "decimal.js";
import type { CatalogCard, GeneratedPack, GeneratedPackCard } from "../packGenerator.types";
import type { CandidateCard, PackGenerationStrategy } from "./PackGenerationStrategy";

// ── Probability constants ────────────────────────────────────────────────────
const GOD_HIT_PROBABILITY = 0.15;        // 15% chance of god-hit anchor selection
const THIRD_CARD_PROBABILITY = 0.15;     // 15% chance of adding a third card

// ── Anchor selection ratios (as fraction of TPV) ────────────────────────────
const GOD_HIT_ANCHOR_MIN_RATIO = 0.65;
const GOD_HIT_ANCHOR_MAX_RATIO = 0.85;
const STANDARD_ANCHOR_MIN_RATIO = 0.4;
const STANDARD_ANCHOR_MAX_RATIO = 0.6;
const VETO_MIN_RATIO = 0.55;             // below this → prefer higher stabilizer

// ── Stabilizer selection ratio (as fraction of remaining balance) ────────────
const STEP2_MIN_RATIO = 0.7;

// ─────────────────────────────────────────────────────────────────────────────
// Tier anchor windows keyed to updated retail prices:
//   Elite    = $12,000 (TPV $9,600)
//   Pinnacle = $18,000 (TPV $14,400)
//   Zenith   = $26,000 (TPV $20,800)
// ─────────────────────────────────────────────────────────────────────────────
type TierWindow = { anchorMinUsd: Decimal; anchorMaxUsd: Decimal };

const TIER_WINDOWS: TierWindow[] = [
  { anchorMinUsd: new Decimal(4575), anchorMaxUsd: new Decimal(5400) },  // Elite   (TPV ~$9,600)
  { anchorMinUsd: new Decimal(5857), anchorMaxUsd: new Decimal(8000) },  // Pinnacle (TPV ~$14,400)
  { anchorMinUsd: new Decimal(8147), anchorMaxUsd: new Decimal(12000) }  // Zenith  (TPV ~$20,800)
];

export class StandardGenerationStrategy implements PackGenerationStrategy {
  public readonly name = "standard";

  generateOnePack(candidates: CandidateCard[], targetPackValue: Decimal, sequence: number): GeneratedPack {
    const selected = new Set<string>();
    const cards: GeneratedPackCard[] = [];

    // Compute the max value the anchor can take so the remaining budget can always
    // accommodate the cheapest card in the pool as the stabilizer.
    // This is the core guard that prevents the stabilizer from having to overshoot.
    const cheapest = this.cheapestCard(candidates);
    const maxAnchorBudget = cheapest
      ? Decimal.max(new Decimal(0), targetPackValue.minus(cheapest.marketValue))
      : targetPackValue;

    const tierWindow = this.resolveTierWindow(targetPackValue);
    const isGodHit = Math.random() < GOD_HIT_PROBABILITY;

    // ── Step 1: Anchor ───────────────────────────────────────────────────────
    const anchor = isGodHit
      ? this.pickGodHitAnchor(candidates, selected, targetPackValue, tierWindow, maxAnchorBudget)
      : this.pickStandardAnchor(candidates, selected, targetPackValue, tierWindow, maxAnchorBudget);

    if (!anchor) {
      return {
        sequence,
        branch: isGodHit ? "god_hit" : "expansion",
        targetPackValueUsd: this.toMoneyString(targetPackValue),
        totalValueUsd: "0.00",
        cards
      };
    }

    selected.add(anchor.card.cardId);
    cards.push(this.asGeneratedCard(anchor.card, "anchor"));

    const afterAnchor = Decimal.max(new Decimal(0), targetPackValue.minus(anchor.marketValue));

    // ── Step 2: Stabilizer — strictly at-or-below remaining budget ───────────
    // Never picks above remaining; if anchor was properly capped the cheapest card
    // always fits here, guaranteeing a valid 2-card pack in ~85%+ of cases.
    if (afterAnchor.greaterThan(0)) {
      const vetoLowRoll = anchor.marketValue.lessThan(targetPackValue.mul(VETO_MIN_RATIO));
      const minStep2 = afterAnchor.mul(vetoLowRoll ? Math.max(STEP2_MIN_RATIO, VETO_MIN_RATIO) : STEP2_MIN_RATIO);
      const preferred = this.filterByRange(this.excludeSelected(candidates, selected), minStep2, afterAnchor);
      const stabilizer =
        preferred.length > 0
          ? this.pickClosestTo(preferred, afterAnchor)
          : this.pickBestAtOrBelow(this.excludeSelected(candidates, selected), afterAnchor);

      if (stabilizer) {
        selected.add(stabilizer.card.cardId);
        cards.push(this.asGeneratedCard(stabilizer.card, "stabilizer"));
      }
    }

    // ── Step 3: Optional third card (15% probability) ────────────────────────
    // Strictly at-or-below remaining budget; skipped if nothing fits.
    if (cards.length < 3 && Math.random() < THIRD_CARD_PROBABILITY) {
      const thirdBudget = this.remainingBudget(targetPackValue, cards);
      if (thirdBudget.greaterThan(0)) {
        const third = this.pickBestAtOrBelow(this.excludeSelected(candidates, selected), thirdBudget);
        if (third) {
          selected.add(third.card.cardId);
          cards.push(this.asGeneratedCard(third.card, "bulk"));
        }
      }
    }

    const totalValue = this.sumGeneratedCardValues(cards);
    return {
      sequence,
      branch: isGodHit ? "god_hit" : "expansion",
      targetPackValueUsd: this.toMoneyString(targetPackValue),
      totalValueUsd: this.toMoneyString(totalValue),
      cards
    };
  }

  // ── Tier window resolution ───────────────────────────────────────────────────
  private resolveTierWindow(targetPackValue: Decimal): TierWindow | null {
    return (
      TIER_WINDOWS.find(
        (w) =>
          targetPackValue.greaterThanOrEqualTo(w.anchorMinUsd.mul(1.5)) &&
          targetPackValue.lessThanOrEqualTo(w.anchorMaxUsd.mul(2.5))
      ) ?? null
    );
  }

  // ── Anchor pickers ───────────────────────────────────────────────────────────
  private pickGodHitAnchor(
    candidates: CandidateCard[],
    selected: Set<string>,
    targetPackValue: Decimal,
    tierWindow: TierWindow | null,
    maxAnchorBudget: Decimal
  ): CandidateCard | null {
    const hardCap = Decimal.min(targetPackValue.mul(GOD_HIT_ANCHOR_MAX_RATIO), maxAnchorBudget);
    const pool = this.excludeSelected(candidates, selected).filter(
      (c) =>
        c.marketValue.greaterThanOrEqualTo(targetPackValue.mul(GOD_HIT_ANCHOR_MIN_RATIO)) &&
        c.marketValue.lessThanOrEqualTo(hardCap) &&
        (!tierWindow || c.marketValue.lessThanOrEqualTo(tierWindow.anchorMaxUsd))
    );
    return (
      this.pickClosestTo(pool, targetPackValue.mul(0.75)) ??
      this.pickBestAtOrBelow(this.excludeSelected(candidates, selected), maxAnchorBudget)
    );
  }

  private pickStandardAnchor(
    candidates: CandidateCard[],
    selected: Set<string>,
    targetPackValue: Decimal,
    tierWindow: TierWindow | null,
    maxAnchorBudget: Decimal
  ): CandidateCard | null {
    // Prefer tier window but honour the anchor budget cap
    if (tierWindow) {
      const byTier = this.filterByRange(
        this.excludeSelected(candidates, selected),
        tierWindow.anchorMinUsd,
        Decimal.min(tierWindow.anchorMaxUsd, maxAnchorBudget)
      );
      if (byTier.length > 0) {
        return this.pickClosestTo(byTier, targetPackValue.mul(0.5));
      }
    }

    const minStd = targetPackValue.mul(STANDARD_ANCHOR_MIN_RATIO);
    const maxStd = Decimal.min(targetPackValue.mul(STANDARD_ANCHOR_MAX_RATIO), maxAnchorBudget);
    const pool = this.filterByRange(this.excludeSelected(candidates, selected), minStd, maxStd);
    return (
      this.pickClosestTo(pool, targetPackValue.mul(0.5)) ??
      this.pickBestAtOrBelow(this.excludeSelected(candidates, selected), maxAnchorBudget)
    );
  }

  // ── Pool helpers ─────────────────────────────────────────────────────────────
  private cheapestCard(candidates: CandidateCard[]): CandidateCard | null {
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => a.marketValue.comparedTo(b.marketValue))[0];
  }

  private pickClosestTo(pool: CandidateCard[], target: Decimal): CandidateCard | null {
    if (pool.length === 0) return null;
    return [...pool].sort((a, b) =>
      a.marketValue.minus(target).abs().comparedTo(b.marketValue.minus(target).abs())
    )[0];
  }

  private pickBestAtOrBelow(pool: CandidateCard[], target: Decimal): CandidateCard | null {
    const eligible = pool
      .filter((c) => c.marketValue.lessThanOrEqualTo(target))
      .sort((a, b) => target.minus(a.marketValue).abs().comparedTo(target.minus(b.marketValue).abs()));
    return eligible[0] ?? null;
  }

  private filterByRange(pool: CandidateCard[], min: Decimal, max: Decimal): CandidateCard[] {
    return pool.filter((c) => c.marketValue.greaterThanOrEqualTo(min) && c.marketValue.lessThanOrEqualTo(max));
  }

  private excludeSelected(pool: CandidateCard[], selected: Set<string>): CandidateCard[] {
    return pool.filter((c) => !selected.has(c.card.cardId));
  }

  // ── Value helpers ────────────────────────────────────────────────────────────
  private sumGeneratedCardValues(cards: GeneratedPackCard[]): Decimal {
    return cards.reduce((sum, card) => sum.plus(card.marketValueUsd), new Decimal(0));
  }

  private remainingBudget(targetPackValue: Decimal, cards: GeneratedPackCard[]): Decimal {
    return Decimal.max(new Decimal(0), targetPackValue.minus(this.sumGeneratedCardValues(cards)));
  }

  private asGeneratedCard(card: CatalogCard, slot: GeneratedPackCard["slot"]): GeneratedPackCard {
    return { ...card, slot };
  }

  private toMoneyString(value: Decimal): string {
    return value.toDecimalPlaces(2).toFixed(2);
  }
}
