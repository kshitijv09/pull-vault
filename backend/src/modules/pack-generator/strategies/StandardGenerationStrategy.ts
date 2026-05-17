import Decimal from "decimal.js";
import type { CatalogCard, GeneratedPack, GeneratedPackCard } from "../packGenerator.types";
import type { CandidateCard, PackGenerationStrategy, RandomSource } from "./PackGenerationStrategy";
import { effectiveRetailSwingProbability, packGeneratorConfig } from "../packGenerator.config";

// ── Probability constants ────────────────────────────────────────────────────
const GOD_HIT_PROBABILITY = 0.1;
const SWING_RANDOM_TRIES = 480;

// ── Anchor selection ratios (as fraction of TPV) ────────────────────────────
const GOD_HIT_ANCHOR_MIN_RATIO = 0.65;
const GOD_HIT_ANCHOR_MAX_RATIO = 0.85;
const STANDARD_ANCHOR_MIN_RATIO = 0.4;
const STANDARD_ANCHOR_MAX_RATIO = 0.6;
const VETO_MIN_RATIO = 0.55;

const STEP2_MIN_RATIO = 0.7;

type TierWindow = { anchorMinUsd: Decimal; anchorMaxUsd: Decimal };

const TIER_WINDOWS: TierWindow[] = [
  { anchorMinUsd: new Decimal(4575), anchorMaxUsd: new Decimal(5400) },
  { anchorMinUsd: new Decimal(5857), anchorMaxUsd: new Decimal(8000) },
  { anchorMinUsd: new Decimal(8147), anchorMaxUsd: new Decimal(12000) }
];

export class StandardGenerationStrategy implements PackGenerationStrategy {
  public readonly name = "standard";

  generateOnePack(
    candidates: CandidateCard[],
    targetPackValue: Decimal,
    sequence: number,
    retailPrice: Decimal,
    dryStreakSinceRetailWin: number,
    rand: RandomSource = Math.random
  ): GeneratedPack {
    const pSwing = Math.min(
      effectiveRetailSwingProbability(dryStreakSinceRetailWin),
      1 - GOD_HIT_PROBABILITY - 1e-9
    );
    const zoneGod = pSwing + GOD_HIT_PROBABILITY;
    const u = rand();

    if (u < pSwing) {
      const swing = this.tryRetailSwingPack(candidates, sequence, targetPackValue, retailPrice, rand);
      if (swing) return swing;
    }

    const isGodHit = u < zoneGod;

    const selected = new Set<string>();
    const cards: GeneratedPackCard[] = [];

    const cheapest = this.cheapestCard(candidates);
    const reserveTwo = this.sumTwoSmallest(candidates);
    const maxAnchorForThree =
      reserveTwo !== null
        ? Decimal.max(new Decimal(0), targetPackValue.minus(reserveTwo))
        : targetPackValue;
    const maxAnchorBudget = cheapest
      ? Decimal.min(
          Decimal.max(new Decimal(0), targetPackValue.minus(cheapest.marketValue)),
          maxAnchorForThree
        )
      : maxAnchorForThree;

    const tierWindow = this.resolveTierWindow(targetPackValue);

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

    if (afterAnchor.greaterThan(0)) {
      const vetoLowRoll = anchor.marketValue.lessThan(targetPackValue.mul(VETO_MIN_RATIO));
      const minStep2 = afterAnchor.mul(vetoLowRoll ? Math.max(STEP2_MIN_RATIO, VETO_MIN_RATIO) : STEP2_MIN_RATIO);
      const poolAfterAnchor = this.excludeSelected(candidates, selected);
      const stabilizer = this.pickStabilizerAllowingThird(
        poolAfterAnchor,
        minStep2,
        afterAnchor,
        candidates,
        selected
      );

      if (stabilizer) {
        selected.add(stabilizer.card.cardId);
        cards.push(this.asGeneratedCard(stabilizer.card, "stabilizer"));
      }
    }

    while (cards.length < 3) {
      const budget = this.remainingBudget(targetPackValue, cards);
      if (budget.lessThanOrEqualTo(0)) break;
      const pool = this.excludeSelected(candidates, selected);
      const next =
        cards.length === 2
          ? this.pickBestAtOrBelow(pool, budget) ?? this.pickSmallestAtOrBelow(pool, budget)
          : this.pickSmallestStabilizerAllowingThird(pool, budget, candidates, selected);
      if (!next) break;
      selected.add(next.card.cardId);
      const slot: GeneratedPackCard["slot"] = cards.length === 1 ? "stabilizer" : "bulk";
      cards.push(this.asGeneratedCard(next.card, slot));
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

  /** Realised value in `[retail, retail × retailSwingPackValueCapRatio]` — **exactly 3 cards**. */
  private tryRetailSwingPack(
    candidates: CandidateCard[],
    sequence: number,
    targetPackValue: Decimal,
    retailPrice: Decimal,
    rand: RandomSource
  ): GeneratedPack | null {
    const cap = retailPrice.mul(packGeneratorConfig.retailSwingPackValueCapRatio);
    if (candidates.length < 3) return null;

    for (let attempt = 0; attempt < SWING_RANDOM_TRIES; attempt++) {
      const a = candidates[Math.floor(rand() * candidates.length)]!;
      const b = candidates[Math.floor(rand() * candidates.length)]!;
      const c = candidates[Math.floor(rand() * candidates.length)]!;
      if (new Set([a.card.cardId, b.card.cardId, c.card.cardId]).size < 3) continue;
      const sum = a.marketValue.plus(b.marketValue).plus(c.marketValue);
      if (sum.greaterThanOrEqualTo(retailPrice) && sum.lessThanOrEqualTo(cap)) {
        const ordered = [a, b, c].sort((x, y) => y.marketValue.comparedTo(x.marketValue));
        return {
          sequence,
          branch: "retail_swing",
          targetPackValueUsd: this.toMoneyString(targetPackValue),
          totalValueUsd: this.toMoneyString(sum),
          cards: [
            this.asGeneratedCard(ordered[0]!.card, "anchor"),
            this.asGeneratedCard(ordered[1]!.card, "stabilizer"),
            this.asGeneratedCard(ordered[2]!.card, "bulk")
          ]
        };
      }
    }

    const sorted = [...candidates].sort((x, y) => x.marketValue.comparedTo(y.marketValue));
    const cheapSlice = sorted.slice(0, Math.min(50, sorted.length));
    const pricey = sorted.slice(Math.max(0, sorted.length - 50));
    for (let t = 0; t < 320; t++) {
      const c0 = cheapSlice[Math.floor(rand() * cheapSlice.length)]!;
      const c1 = cheapSlice[Math.floor(rand() * cheapSlice.length)]!;
      const p = pricey[Math.floor(rand() * pricey.length)]!;
      if (new Set([c0.card.cardId, c1.card.cardId, p.card.cardId]).size < 3) continue;
      const sum = c0.marketValue.plus(c1.marketValue).plus(p.marketValue);
      if (sum.greaterThanOrEqualTo(retailPrice) && sum.lessThanOrEqualTo(cap)) {
        const ordered = [c0, c1, p].sort((x, y) => y.marketValue.comparedTo(x.marketValue));
        return {
          sequence,
          branch: "retail_swing",
          targetPackValueUsd: this.toMoneyString(targetPackValue),
          totalValueUsd: this.toMoneyString(sum),
          cards: [
            this.asGeneratedCard(ordered[0]!.card, "anchor"),
            this.asGeneratedCard(ordered[1]!.card, "stabilizer"),
            this.asGeneratedCard(ordered[2]!.card, "bulk")
          ]
        };
      }
    }
    return null;
  }

  private sumTwoSmallest(candidates: CandidateCard[]): Decimal | null {
    if (candidates.length < 2) return null;
    const s = [...candidates].sort((a, b) => a.marketValue.comparedTo(b.marketValue));
    return s[0]!.marketValue.plus(s[1]!.marketValue);
  }

  /** Prefer STEP2/VETO band, but only if some third card fits under remaining TPV. */
  private pickStabilizerAllowingThird(
    poolAfterAnchor: CandidateCard[],
    minStep2: Decimal,
    afterAnchor: Decimal,
    candidates: CandidateCard[],
    selected: Set<string>
  ): CandidateCard | null {
    const tryOrder: CandidateCard[] = [];
    const seen = new Set<string>();
    const preferred = this.filterByRange(poolAfterAnchor, minStep2, afterAnchor);
    const prefSorted = [...preferred].sort((a, b) =>
      a.marketValue.minus(afterAnchor).abs().comparedTo(b.marketValue.minus(afterAnchor).abs())
    );
    for (const s of prefSorted) {
      if (seen.has(s.card.cardId)) continue;
      seen.add(s.card.cardId);
      tryOrder.push(s);
    }
    const restSorted = poolAfterAnchor
      .filter((c) => !seen.has(c.card.cardId))
      .sort((a, b) =>
        a.marketValue.minus(afterAnchor).abs().comparedTo(b.marketValue.minus(afterAnchor).abs())
      );
    tryOrder.push(...restSorted);

    for (const stab of tryOrder) {
      if (stab.marketValue.greaterThan(afterAnchor)) continue;
      const rem = afterAnchor.minus(stab.marketValue);
      const sel = new Set(selected);
      sel.add(stab.card.cardId);
      const third = this.pickBestAtOrBelow(this.excludeSelected(candidates, sel), rem);
      if (third) return stab;
    }
    return null;
  }

  /** Ascending-value search for a second card when preferred stabilizer failed. */
  private pickSmallestStabilizerAllowingThird(
    pool: CandidateCard[],
    budget: Decimal,
    candidates: CandidateCard[],
    selected: Set<string>
  ): CandidateCard | null {
    const sorted = [...pool].sort((a, b) => a.marketValue.comparedTo(b.marketValue));
    for (const stab of sorted) {
      if (stab.marketValue.greaterThan(budget)) break;
      const rem = budget.minus(stab.marketValue);
      const sel = new Set(selected);
      sel.add(stab.card.cardId);
      const third = this.pickBestAtOrBelow(this.excludeSelected(candidates, sel), rem);
      if (third) return stab;
    }
    return null;
  }

  private resolveTierWindow(targetPackValue: Decimal): TierWindow | null {
    return (
      TIER_WINDOWS.find(
        (w) =>
          targetPackValue.greaterThanOrEqualTo(w.anchorMinUsd.mul(1.5)) &&
          targetPackValue.lessThanOrEqualTo(w.anchorMaxUsd.mul(2.5))
      ) ?? null
    );
  }

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

  private cheapestCard(candidates: CandidateCard[]): CandidateCard | null {
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => a.marketValue.comparedTo(b.marketValue))[0]!;
  }

  private pickClosestTo(pool: CandidateCard[], target: Decimal): CandidateCard | null {
    if (pool.length === 0) return null;
    return [...pool].sort((a, b) =>
      a.marketValue.minus(target).abs().comparedTo(b.marketValue.minus(target).abs())
    )[0]!;
  }

  private pickBestAtOrBelow(pool: CandidateCard[], target: Decimal): CandidateCard | null {
    const eligible = pool
      .filter((c) => c.marketValue.lessThanOrEqualTo(target))
      .sort((a, b) => target.minus(a.marketValue).abs().comparedTo(target.minus(b.marketValue).abs()));
    return eligible[0] ?? null;
  }

  private pickSmallestAtOrBelow(pool: CandidateCard[], cap: Decimal): CandidateCard | null {
    const ok = pool
      .filter((c) => c.marketValue.lessThanOrEqualTo(cap))
      .sort((a, b) => a.marketValue.comparedTo(b.marketValue));
    return ok[0] ?? null;
  }

  private filterByRange(pool: CandidateCard[], min: Decimal, max: Decimal): CandidateCard[] {
    return pool.filter((c) => c.marketValue.greaterThanOrEqualTo(min) && c.marketValue.lessThanOrEqualTo(max));
  }

  private excludeSelected(pool: CandidateCard[], selected: Set<string>): CandidateCard[] {
    return pool.filter((c) => !selected.has(c.card.cardId));
  }

  private sumGeneratedCardValues(cards: GeneratedPackCard[]): Decimal {
    return cards.reduce((sum, card) => sum.plus(new Decimal(card.marketValueUsd)), new Decimal(0));
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
