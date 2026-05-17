/**
 * Canonical transcript for Phase 2 fairness derivations.
 *
 * The byte layout is fixed and versioned via `algorithm_version` so the browser
 * verifier in Phase 4 can rebuild the exact same `message` to seed the RNG.
 *
 * Format: one `key:value` per line, `\n`-separated, UTF-8 encoded. Keys are
 * fixed, lower-case, never reordered, and never abbreviated differently than
 * defined below.
 */

export interface FairnessTranscriptInputs {
  algorithmVersion: string;
  nonce: string;
  clientSeed: string;
  dropId: string;
  userPackId: string;
  packInventoryId: string;
  poolFingerprintHex: string;
  targetPackValueUsd: string;
  retailPriceUsd: string;
  sequence: number;
  dryStreakSinceRetailWin: number;
}

export function buildFairnessTranscriptMessage(inputs: FairnessTranscriptInputs): Buffer {
  const lines = [
    `alg:${inputs.algorithmVersion}`,
    `nonce:${inputs.nonce}`,
    `cseed:${inputs.clientSeed}`,
    `drop:${inputs.dropId}`,
    `upack:${inputs.userPackId}`,
    `pinv:${inputs.packInventoryId}`,
    `pool:${inputs.poolFingerprintHex}`,
    `tpv:${inputs.targetPackValueUsd}`,
    `retail:${inputs.retailPriceUsd}`,
    `seq:${inputs.sequence}`,
    `dry:${inputs.dryStreakSinceRetailWin}`
  ];
  return Buffer.from(lines.join("\n"), "utf8");
}

/** Plain object form persisted to `pack_fairness_commit.transcript` for Phase 3 reveal. */
export function serializeFairnessTranscript(inputs: FairnessTranscriptInputs): Record<string, unknown> {
  return {
    algorithm_version: inputs.algorithmVersion,
    nonce: inputs.nonce,
    client_seed: inputs.clientSeed,
    drop_id: inputs.dropId,
    user_pack_id: inputs.userPackId,
    pack_inventory_id: inputs.packInventoryId,
    pool_fingerprint_hex: inputs.poolFingerprintHex,
    target_pack_value_usd: inputs.targetPackValueUsd,
    retail_price_usd: inputs.retailPriceUsd,
    sequence: inputs.sequence,
    dry_streak_since_retail_win: inputs.dryStreakSinceRetailWin
  };
}
