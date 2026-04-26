# Pack Logic

## Logic

The premium pack generator is designed to keep each pack's realized value controlled against a target value band. The strategy uses a waterfall:

1. Pick an anchor card from the tier's preferred value window.
2. Pick a stabilizer card based on remaining budget.
3. Optionally add a third card when budget safely allows.

The hard goal is to avoid overshooting the target pack value while still producing high-variance outcomes that feel exciting.

## Architecture as Implemented

- **Tier targets** are modeled around TPV = 90% of retail for Elite, Pinnacle, and Zenith packs.
- **Step 1 (anchor card)**:
  - 15% God Hit path targets 65% to 85% of TPV.
  - 85% Standard Hit path targets 40% to 60% of TPV.
  - A budget-cap guard (`TPV - cheapest_card`) prevents impossible remainders.
- **Step 2 (stabilizer)**:
  - Preferred selection is 70% to 100% of remaining budget.
  - Selection is strictly at-or-below remaining budget.
  - If no exact preferred-range card exists, it degrades to closest at-or-below value.
- **Step 3 (optional third card)**:
  - Runs with ~15% probability.
  - Added only if a valid at-or-below card exists after Step 2.
- **Operational guardrails**:
  - APV target is kept at or below TPV.
  - Selection windows are treated as soft preferences, not fatal constraints.
  - In rare inventory-edge cases, generation can finalize with fewer cards instead of forcing overshoot.
