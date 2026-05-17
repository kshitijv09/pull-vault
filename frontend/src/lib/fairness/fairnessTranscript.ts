/**
 * Browser port of `backend/src/shared/crypto/fairnessTranscript.ts`.
 *
 * The byte layout is fixed and versioned via `algorithm_version` so the
 * verifier rebuilds the exact same HMAC `message`.
 *
 * Format: one `key:value` per line, `\n`-separated, UTF-8 encoded. Keys are
 * fixed, lower-case, never reordered.
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

export function buildFairnessTranscriptMessage(
  inputs: FairnessTranscriptInputs
): Uint8Array {
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
  return new TextEncoder().encode(lines.join("\n"));
}

/**
 * Parse the persisted transcript JSON object back into `FairnessTranscriptInputs`.
 * The server writes this with `serializeFairnessTranscript`; the field names use
 * snake_case there.
 */
export function parsePersistedTranscript(
  raw: Record<string, unknown>
): FairnessTranscriptInputs {
  const need = (key: string): string => {
    const value = raw[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`fairness transcript: missing required string field "${key}"`);
    }
    return value;
  };
  const needNum = (key: string): number => {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`fairness transcript: missing required number field "${key}"`);
    }
    return value;
  };

  return {
    algorithmVersion: need("algorithm_version"),
    nonce: need("nonce"),
    clientSeed: need("client_seed"),
    dropId: need("drop_id"),
    userPackId: need("user_pack_id"),
    packInventoryId: need("pack_inventory_id"),
    poolFingerprintHex: need("pool_fingerprint_hex"),
    targetPackValueUsd: need("target_pack_value_usd"),
    retailPriceUsd: need("retail_price_usd"),
    sequence: needNum("sequence"),
    dryStreakSinceRetailWin: needNum("dry_streak_since_retail_win")
  };
}
