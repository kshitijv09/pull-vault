/**
 * Browser port of `computePoolFingerprintHex` from the backend.
 *
 * Canonical serialization is byte-stable across server and browser:
 *
 *   id + "|" + marketValueUsd + "\n"
 *
 * concatenated in pool order, then SHA-256 hex of the result.
 */

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export async function computePoolFingerprintHex(
  candidates: ReadonlyArray<{ id: string; marketValueUsd: string }>
): Promise<string> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const c of candidates) {
    const line = encoder.encode(`${c.id}|${c.marketValueUsd}\n`);
    parts.push(line);
    total += line.length;
  }
  const buffer = new Uint8Array(total);
  let off = 0;
  for (const part of parts) {
    buffer.set(part, off);
    off += part.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return bytesToHex(new Uint8Array(digest));
}

/** SHA-256 over UTF-8 hex bytes of `server_secret_hex`, used for the Phase 1 commitment check. */
export async function sha256OfHexBytes(hex: string): Promise<string> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}
