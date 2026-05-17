# Pack economics

How tier pricing, TPV, and `StandardGenerationStrategy` interact.

**Config (source of truth for numbers):** `src/modules/pack-generator/packGenerator.config.ts`  
**Branch draw + how cards are chosen inside each pack:** `pack-generator-distribution.md`  
**Algorithm entrypoints:** `StandardGenerationStrategy.ts`, `packGenerator.service.ts`

---

## Tier retail and TPV

**`targetPackValueRatio`** (see config; example **1.0**) → \(TPV_t = P_t \times \texttt{targetPackValueRatio}\). When ratio is **1.0**, TPV equals retail.

| `tier_name` | Retail \(P_t\) | TPV (= \(P_t\) × ratio) |
|-------------|----------------|-------------------------|
| `entry` | $5,499 | $5,499.00 |
| `core` | $13,499 | $13,499.00 |
| `ultra` | $31,999 | $31,999.00 |

**Win (simulation):** realised card value sum \(\geq P_t\) (same threshold as TPV when ratio = 1).

---

## Three branches (`generateOnePack`)

One uniform draw \(u \in [0,1)\) (see `retailSwingProbability`, `GOD_HIT_PROBABILITY` in code):

1. **`retail_swing`** if \(u < p_{\text{swing}}\) (see **`retailSwingProbability`**, **`retailSwingProbabilityMax`**, dry-streak boost in config)  
   - Targets **realised \(\geq P_t\)**; cap **`retailSwingPackValueCapRatio × P_t`**.

2. **`god_hit`** if \(p_{\text{swing}} \leq u < p_{\text{swing}} + 0.10\)  
   - Anchor band **[0.65×TPV, 0.85×TPV]** (clamped by `maxAnchorBudget` and optional tier window).  
   - Stabilizer and **third** card use **remaining TPV** → total **≤ TPV** (packs are **3 cards**).

3. **`expansion`** otherwise (nominal strip width **\(1 - p_{\text{swing}} - 0.10\)**; e.g. **~75%** when \(p_{\text{swing}} = 0.15\) and god strip is **10%**)  
   - Anchor cap includes room for two fillers (**`TPV − sum(two smallest)`** vs **`TPV − cheapest`**); tier USD windows when `resolveTierWindow(TPV)` matches; else **40–60%** TPV.  
   - Stabilizer / third use **TPV** slack only (same **3-card** construction as god after the branch split).

**Stabilizer (god / expansion):** **`max(0, TPV − anchor)`**; STEP2 / VETO rules as in code.

---

## Tier anchor windows (USD, `expansion` branch only)

Match when \(TPV \in [1.5 \cdot anchorMin,\ 2.5 \cdot anchorMax]\). Values are the **`TIER_WINDOWS`** rows in `StandardGenerationStrategy.ts` (legacy USD bands; not re-derived from current tier retail names).

| Row | `anchorMinUsd` | `anchorMaxUsd` |
|-----|----------------|----------------|
| 1 | $4,575 | $5,400 |
| 2 | $5,857 | $8,000 |
| 3 | $8,147 | $12,000 |

---

## Rarity helpers

**`CARD_VALUE_USD_RARITY_BANDS`** (and related helpers in `packGenerator.config.ts`) — used for simulation ladder labelling and any callers that map USD → band; **`StandardGenerationStrategy`** god/expansion picks are primarily **by USD value**, not by enforcing a rarity mix.

---

## Config knobs (retail-win minority)

| Field | Role |
|-------|------|
| `targetPackValueRatio` | TPV = retail × ratio (e.g. **1.0** = TPV equals retail; **0.80** = 20% headroom vs retail). |
| `retailSwingProbability` / `Max` / `PerDryPack` | Base and boosted attempt rate for `retail_swing` (see `effectiveRetailSwingProbability`). |
| `retailSwingPackValueCapRatio` | Max swing-pack realised value vs retail. |
| `winRateFloor` / `winRateCeiling` | Simulation bounds on observed retail-win share (±3pp tolerance in service). |

---

## Batch vs simulation

**Batch guard:** `count ≥ 100` → mean realised \(\in [0.96 \times TPV,\ 1.2 \times TPV]\) or **422**.

**Simulation margin (`marginWithin2ppOfTarget`):** when ratio **≥ 1**, house margin \((P_t - \bar{v})/P_t\) must be within **±2pp** of **0** (i.e. average realised near retail). When ratio **\< 1**, keeps the prior one-sided floor (within 2pp below target margin).

---

## Simulation API

`POST /pack-generator/simulate` — **`acceptanceCriteria`** includes margin, win-rate floor/ceiling, **`p5AboveZero`**.

---

## Not implemented

No post–price-sync auto-tuning of ratios; `packs.rarity_weights` not filled by this strategy.
