import type { DropCardPoolSnapshotEntry } from "./dropCardPoolSnapshot.types";

export interface PackFairnessRevealOutcomeCard {
  /** `card.id` (catalog UUID). */
  catalogCardId: string;
  /** External (TCG) id from `card.card_id`. */
  externalCardId: string;
  name: string;
  cardSet: string;
  rarity: string;
  imageUrl: string;
  marketValueUsd: string;
  acquisitionPriceUsd: string;
}

export interface PackFairnessRevealPhase1 {
  nonce: string;
  clientSeed: string;
  clientSeedSource: "user" | "server";
  serverCommitmentHex: string;
}

export interface PackFairnessRevealPhase2 {
  serverSecretHex: string;
  poolFingerprintHex: string;
  /** Same key/value bag persisted to `pack_fairness_commit.transcript`. */
  transcript: Record<string, unknown>;
}

export interface PackFairnessRevealResponse {
  userPackId: string;
  dropId: string;
  packInventoryId: string;
  fairnessMode: "fairness";
  algorithmVersion: string;
  consumedAt: string;
  phase1: PackFairnessRevealPhase1;
  phase2: PackFairnessRevealPhase2;
  outcome: {
    cards: PackFairnessRevealOutcomeCard[];
  };
  /**
   * Endpoint the browser verifier should hit to download the ordered pool
   * snapshot for this drop. Returned alongside the snapshot fingerprint so
   * clients can verify they received the right pool.
   */
  poolSnapshot: {
    url: string;
    fingerprintHex: string;
    createdAt: string;
  };
}

export interface PackFairnessPoolSnapshotResponse {
  dropId: string;
  fingerprintHex: string;
  createdAt: string;
  entries: DropCardPoolSnapshotEntry[];
}
