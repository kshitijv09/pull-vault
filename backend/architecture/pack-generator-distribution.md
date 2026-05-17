# Pack generator: branch draw and card selection

This document describes how **`StandardGenerationStrategy`** chooses a **branch** (`retail_swing` | `god_hit` | `expansion`) and how **cards** are picked inside each pack. **Numeric defaults** live in **`src/modules/pack-generator/packGenerator.config.ts`**; treat that file as source of truth if this doc drifts.

**Code:** `StandardGenerationStrategy.ts`, `PackGenerationStrategy.ts`, `packGenerator.service.ts`.

---

## Terms

| Term | Meaning |
|------|--------|
| **Retail** | Pack sticker price for the tier (`tierConfig[tier].retailPriceUsd`). |
| **TPV** | Target pack value: `retail × targetPackValueRatio` (used as a **budget ceiling** for `god_hit` / `expansion`). |
| **Realised value** | Sum of selected cards’ `marketValueUsd`. |
| **Win** | Realised value **≥ retail** (used in simulation stats). |
| **Branch** | `GeneratedPack.branch`: which construction path built the pack. |
| **Candidate** | `CandidateCard`: a catalog card plus its price as a `Decimal`. |
| **Slot** | `anchor`, `stabilizer`, or `bulk` on `GeneratedPackCard` (ordering / semantics, not a separate rarity system). |
| **Dry streak** | Consecutive packs with realised value **strictly below** retail; increases the effective `retail_swing` attempt rate up to a configured cap. |

---

## Where candidates come from

**Batch generation** (`PackGeneratorService.generatePackBatch` → `POST /pack-generator/packs`):

- Uses the **same** `generateOnePack` / `StandardGenerationStrategy` path as **simulate** (not a separate algorithm).
- Loads **all** rows from the card catalog (`PackGeneratorRepository.findAllCatalogCards`); requires at least **`PACK_GENERATOR_CARDS_PER_PACK`** (**3**) cards.
- After generation, **`assertEachPackHasExpectedCardCount`** rejects any pack with fewer/more than **3** cards before `insertGeneratedPackBatch` writes `packs` + `pack_card`.
- **Tier** only sets **retail** and **TPV**; it does **not** restrict which cards are eligible.

**Purchase assignment** (`packPurchaseQueueConsumer`): does **not** re-run the strategy; it loads the same `pack_card` rows created at batch time and asserts they match **`cards_per_pack`** and **`PACK_GENERATOR_CARDS_PER_PACK`** (**3**).

**In-place regeneration:** `POST /pack-generator/packs/regenerate-cards` with `{ "pack_ids": ["<packs.id>", ...] }` (≤100, unique UUIDs). Runs **`StandardGenerationStrategy`** per id using that row’s **`packs.price`** as retail, replaces **`pack_card`** in one transaction (all ids succeed or none).

**Sellable unit lifecycle (`pack_inventory.status`):** see **`shared/constants/packInventoryStatus.constants.ts`** and migration **`031_pack_inventory_lifecycle_status.sql`**: `created` → `in_drop_sale` (listed on a drop) → `reserved` (optional hold) → `owned` (sold to user). **`legacy`** is retained for migrated rows.

**Simulation** (`simulatePacks`):

- Builds a **synthetic** candidate list from **`SIMULATION_ONLY_CARD_PRICES_USD`** (fixed USD ladder + synthetic names), so runs do not depend on DB inventory.

---

## Branch selection (one random draw)

The strategy draws **`u ~ Uniform(0, 1)`** and fixes:

- **`pSwing`** = `effectiveRetailSwingProbability(dryStreak)`, clamped so **`pSwing + GOD_HIT_PROBABILITY < 1`** (`GOD_HIT_PROBABILITY` = **0.10** in code).
- **`zoneGod`** = `pSwing + 0.10`.

**Zones on the unit interval:**

1. **`[0, pSwing)`** — attempt **`retail_swing`**. If `tryRetailSwingPack` **returns null** (could not find a valid combo), execution **continues**; **`isGodHit`** is still computed from the **same** `u`.
2. **`[pSwing, zoneGod)`** — **`god_hit`** (10 percentage points wide).
3. **`[zoneGod, 1)`** — **`expansion`**.

So with **`pSwing = 0.15`** (base from config at dry streak 0) and god **10%**: nominal strip widths are **15% / 10% / 75%** for swing *attempt* / god / expansion. **Observed** `retail_swing` rate is **≤ `pSwing`** because construction can fail; failed swing attempts with `u < pSwing` still satisfy `u < zoneGod`, so they become **`god_hit`** construction, which **inflates** realised `god_hit` share above **10%** when the swing builder often fails. **`expansion`** share stays **~`1 - pSwing - 0.10`**.

**Dry streak:** the service updates streak after each pack (batch or simulation). Optional body field **`dry_streak_initial`** / **`dryStreakInitial`** seeds the streak for the first pack.

---

## Card distribution by branch

Selection is **price-driven** (market USD), not a fixed mix of rarity labels. There is **no** “10% rare / 90% common” quota in this strategy.

### A. `retail_swing`

**Goal:** realised total in **`[retail, retail × retailSwingPackValueCapRatio]`** (config, e.g. **1.2** → up to 120% of retail).

**Algorithm (`tryRetailSwingPack`):** **exactly three** distinct cards whose sum lies in the band.

1. Random trials of **three distinct** candidates until sum \(\in [retail, cap]\).
2. If that fails: two picks from the **cheapest 50** and one from the **priciest 50** (distinct), same band check.
3. **Slots:** sort chosen cards by value descending → **`anchor`**, **`stabilizer`**, **`bulk`**.

This path **ignores TPV** for the total cap; it only uses **retail** and **cap**.

### B. `god_hit` and `expansion` (TPV-budgeted, **3 cards**)

**Budget:** **`targetPackValue` (TPV)**. All picks stay **at or under** remaining TPV.

**0. Anchor safety**

- **`maxAnchorBudget`** = `min(TPV − cheapest, TPV − (sum of two smallest candidate prices))` so there is slack for **two** more cards in the worst case.

**1. Anchor (first card)**

- **`god_hit`:** pool = candidates whose value is in **[0.65×TPV, min(0.85×TPV, maxAnchorBudget)]**, optionally also capped by **`tierWindow.anchorMaxUsd`** when a tier window matches. Pick **closest to 0.75×TPV**. If empty, fall back to **best at or below `maxAnchorBudget`**.
- **`expansion`:** if `resolveTierWindow(TPV)` matches a row in **`TIER_WINDOWS`**, anchor from that USD band (closest to **0.5×TPV**). Else pool **[0.40×TPV, min(0.60×TPV, maxAnchorBudget)]**, closest to **0.5×TPV**, with the same fallback.

**`resolveTierWindow`:** picks a window when `TPV` lies in `[1.5 × anchorMin, 2.5 × anchorMax]` for that row (see `StandardGenerationStrategy.ts`).

**2. Stabilizer (second card)**

- **`afterAnchor`** = `TPV − anchor_value`.
- If anchor is **below 55%×TPV**, the minimum for the stabilizer is **lifted** (uses `max(STEP2_MIN_RATIO, VETO_MIN_RATIO)` with `STEP2_MIN_RATIO = 0.7`).
- **`pickStabilizerAllowingThird`:** among preferred range then full pool (closest-to-`afterAnchor` ordering), pick the first stabilizer such that **some third card** exists with value **≤** remaining TPV after that stabilizer.

**3. Third card (`bulk`)**

- After a feasible stabilizer, append the third with **`pickBestAtOrBelow`** (fallback **`pickSmallestAtOrBelow`**). If the preferred stabilizer path failed, a **`while`** loop fills to three using **`pickSmallestStabilizerAllowingThird`** then the same third logic.

**Failure:** if no anchor is found, the pack may return **zero cards** and **$0.00** total for that branch attempt (edge case). With a very thin catalog, fewer than three cards can still result (rare).

---

## Simulation vs enforcement

- **`computeSimulationStats`** computes **win rate**, **`lossCount`**, per-pack margin, histogram, **`results.netProfitLossPctOnCardValue`** (`(Σ retail − Σ realised) / Σ realised`), **`aggregateTotalRetailUsd`**, **`aggregateTotalRealisedValueUsd`**, and **`results.packCounts`**: **`byBranch`** (`godHit`, **`standard`** = `expansion` branch, `retailSwing`, `total`) and **`byOutcome`** (`win`, `loss`, `total`). Each inner **`total`** equals **`simulationCount`**. Legacy flat fields **`godHitCount`** / **`retailSwingCount`** remain on **`results`**.
- **`acceptanceCriteria`** (e.g. margin band, **`winRateFloor`** / **`winRateCeiling`** with ±3pp) is a **reporting gate** on a batch run — it does **not** re-roll packs to force a target distribution.

---

## Related docs

- **`pack-economics.md`** — tier table and economics framing (keep aligned with `packGenerator.config.ts`).
- **`pack-logic.md`** — short operational summary; detailed behaviour is here.
