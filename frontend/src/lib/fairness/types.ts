/**
 * Shapes mirrored from `backend/src/modules/drop/packFairnessReveal.types.ts`
 * and `dropCardPoolSnapshot.types.ts`. Kept in this module so the verifier is
 * self-contained.
 */

export interface PackFairnessRevealOutcomeCard {
  catalogCardId: string;
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
  poolSnapshot: {
    url: string;
    fingerprintHex: string;
    createdAt: string;
  };
}

export interface PackFairnessPoolSnapshotEntry {
  poolIndex: number;
  cardId: string;
  externalCardId: string;
  name: string;
  cardSet: string;
  rarity: string;
  imageUrl: string;
  marketValueUsdSnapshot: string;
}

export interface PackFairnessPoolSnapshotResponse {
  dropId: string;
  fingerprintHex: string;
  createdAt: string;
  entries: PackFairnessPoolSnapshotEntry[];
}
