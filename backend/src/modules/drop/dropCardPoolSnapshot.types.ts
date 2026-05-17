export interface DropCardPoolSnapshotEntry {
  /** 0-based canonical index used to compute `pool_snapshot_fingerprint_hex`. */
  poolIndex: number;
  /** `card.id` (catalog UUID). */
  cardId: string;
  /** External (TCG) card id from `card.card_id`. */
  externalCardId: string;
  name: string;
  cardSet: string;
  rarity: string;
  imageUrl: string;
  /** Market value pinned at snapshot creation; never updated. */
  marketValueUsdSnapshot: string;
}

export interface DropCardPoolSnapshot {
  dropId: string;
  fingerprintHex: string;
  createdAt: string;
  entries: DropCardPoolSnapshotEntry[];
}
