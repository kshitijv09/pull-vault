/**
 * Browser port of `backend/src/shared/crypto/seededRng.ts`.
 *
 *   block(i) = HMAC_SHA256(server_secret, message || u32be(i))
 *   stream   = block(0) || block(1) || block(2) || ...
 *
 * Floats consume 53 bits (27 + 26) and indices use rejection sampling on
 * uint32 values, exactly like the server, so a given `(server_secret, message)`
 * reproduces the same draw sequence.
 *
 * Web Crypto signs asynchronously, so the byte stream is **prefilled** once
 * up front and consumed synchronously afterwards. `StandardGenerationStrategy`
 * worst case (swing branch) is ~9.6 KiB of random bytes; we prefill 16 KiB
 * (512 HMAC blocks) which leaves an order-of-magnitude headroom.
 */

const PREFILL_BLOCKS = 512;
const BLOCK_BYTES = 32;

export interface SeededRng {
  /** Uniform float in [0, 1) with 53 bits of precision. */
  nextFloat(): number;
  /** Uniform integer in [0, n) using rejection sampling. */
  nextIndex(n: number): number;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) {
    throw new Error("hexToBytes: odd-length hex input");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) {
      throw new Error("hexToBytes: invalid hex character");
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Generate `numBlocks` consecutive HMAC-SHA256 blocks for the given `(key, message)`
 * pair. Returns a single concatenated `Uint8Array` of length `numBlocks × 32`.
 */
async function generateStream(
  key: CryptoKey,
  message: Uint8Array,
  numBlocks: number
): Promise<Uint8Array> {
  const out = new Uint8Array(numBlocks * BLOCK_BYTES);
  const input = new Uint8Array(message.length + 4);
  input.set(message, 0);
  const counterView = new DataView(input.buffer, message.length, 4);
  for (let i = 0; i < numBlocks; i += 1) {
    counterView.setUint32(0, i >>> 0, false);
    const sig = await crypto.subtle.sign({ name: "HMAC" }, key, input as unknown as BufferSource);
    out.set(new Uint8Array(sig), i * BLOCK_BYTES);
  }
  return out;
}

/**
 * Build a seeded RNG over the entire HMAC stream. The strategy port consumes
 * the stream synchronously, so all blocks are derived up front.
 */
export async function createSeededRng(
  serverSecret: Uint8Array,
  message: Uint8Array
): Promise<SeededRng> {
  if (serverSecret.length === 0) {
    throw new Error("createSeededRng: server_secret is empty");
  }
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("createSeededRng: Web Crypto is unavailable in this environment");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    serverSecret as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const stream = await generateStream(key, message, PREFILL_BLOCKS);
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  let cursor = 0;

  const ensure = (needed: number): void => {
    if (cursor + needed > stream.byteLength) {
      throw new Error(
        `createSeededRng: prefilled stream exhausted (need ${needed}, remaining ${
          stream.byteLength - cursor
        }). Increase PREFILL_BLOCKS.`
      );
    }
  };

  const nextUint32 = (): number => {
    ensure(4);
    const x = view.getUint32(cursor, false);
    cursor += 4;
    return x >>> 0;
  };

  const nextFloat = (): number => {
    ensure(8);
    const hi = (view.getUint32(cursor, false) >>> 0) >>> 5;
    const lo = (view.getUint32(cursor + 4, false) >>> 0) >>> 6;
    cursor += 8;
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

/** `() => number` adapter for the legacy strategy signature that wants a `Math.random` callback. */
export function asMathRandom(rng: SeededRng): () => number {
  return () => rng.nextFloat();
}

export { hexToBytes };
