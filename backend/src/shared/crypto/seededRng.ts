import { createHash, createHmac } from "node:crypto";

/**
 * Provably-fair RNG built on HMAC-SHA256 in counter mode.
 *
 *   block(i) = HMAC_SHA256(server_secret, message || u32be(i))
 *   stream   = block(0) || block(1) || block(2) || ...
 *
 * Floats are produced by combining 53 bits (27 + 26) from the stream, matching
 * the precision of `Math.random()`. Indices use rejection sampling on uint32
 * values to avoid modulo bias.
 *
 * The same `(serverSecret, message)` pair always reproduces the same draw
 * sequence, which is exactly what the browser verifier needs in Phase 4.
 */
export interface SeededRng {
  /** Uniform float in [0, 1) with 53 bits of precision. */
  nextFloat(): number;
  /** Uniform integer in [0, n) using rejection sampling. */
  nextIndex(n: number): number;
}

export function createSeededRng(serverSecret: Buffer, message: Buffer): SeededRng {
  if (serverSecret.length === 0) {
    throw new Error("createSeededRng: server_secret is empty");
  }

  let counter = 0;
  let buffer = Buffer.alloc(0);

  const refill = (needed: number): void => {
    while (buffer.length < needed) {
      const counterBytes = Buffer.alloc(4);
      counterBytes.writeUInt32BE(counter >>> 0, 0);
      counter += 1;
      const block = createHmac("sha256", serverSecret).update(message).update(counterBytes).digest();
      buffer = Buffer.concat([buffer, block]);
    }
  };

  const nextUint32 = (): number => {
    refill(4);
    const x = buffer.readUInt32BE(0);
    buffer = buffer.subarray(4);
    return x >>> 0;
  };

  const nextFloat = (): number => {
    refill(8);
    const hi = buffer.readUInt32BE(0) >>> 5;
    const lo = buffer.readUInt32BE(4) >>> 6;
    buffer = buffer.subarray(8);
    return (hi * Math.pow(2, 26) + lo) / Math.pow(2, 53);
  };

  const nextIndex = (n: number): number => {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`SeededRng.nextIndex requires positive integer n; got ${n}`);
    }
    if (n === 1) return 0;
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    while (true) {
      const x = nextUint32();
      if (x < limit) return x % n;
    }
  };

  return { nextFloat, nextIndex };
}

/** Build a `() => number` shim for legacy APIs that expect `Math.random`-style callbacks. */
export function asMathRandom(rng: SeededRng): () => number {
  return () => rng.nextFloat();
}

/**
 * Canonical SHA-256 fingerprint of an ordered candidate pool. The serialization
 * must be byte-stable across server and browser: id + "|" + market value + "\n".
 */
export function computePoolFingerprintHex(
  candidates: ReadonlyArray<{ id: string; marketValueUsd: string }>
): string {
  const hash = createHash("sha256");
  for (const c of candidates) {
    hash.update(c.id);
    hash.update("|");
    hash.update(c.marketValueUsd);
    hash.update("\n");
  }
  return hash.digest("hex");
}
