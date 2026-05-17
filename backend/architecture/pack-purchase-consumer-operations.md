# Pack Purchase Consumer Operations

## Logic

The consumer is responsible for the authoritative fulfillment phase after a pack reservation is queued. It must ensure:

- atomic wallet + inventory + ownership writes,
- no partial purchase state,
- and safe reservation recovery on failure.

## Architecture as Implemented

- **Worker**
  - File: `backend/src/workers/packPurchaseQueueConsumer.ts`
  - Queue: `env.packPurchaseQueueName` (default `pack_purchases`)
- **Success flow**
  1. Pop queue message (`BLPOP`).
  2. Validate payload (`userId`, `tierId`, `dropId`, `packId`).
  3. Begin DB transaction.
  4. Lock target `pack_inventory` + pack row, validate **`pack_inventory.status === in_drop_sale`** (listed in drop) and drop match.
  5. Load catalog cards for selected pack (`pack_card` for the pack template). Asserts `len(pack_card) === packs.cards_per_pack` and `cards_per_pack === PACK_GENERATOR_CARDS_PER_PACK` (**3**) so fulfillment matches **`StandardGenerationStrategy`** output from `POST /pack-generator/packs`.
  6. Resolve acquisition prices (TCG near_mint when available, fallback to catalog value).
  7. Lock user wallet row and validate sufficient balance.
  8. Debit user wallet.
  9. Mark inventory row **`owned`** (`pack_inventory.status`, was `sold` / `available` in older schemas).
  10. Insert `user_packs` record.
  11. Insert `user_cards` rows.
  12. Record company earnings ledger for pack purchase.
  13. Commit transaction.
- **Failure flow**
  - Transaction rolls back automatically.
  - Consumer attempts Redis reservation restore (`releaseReservation`) with retries.
  - Restore script increments pack remaining, re-enqueues tier availability when needed, and publishes release event.
