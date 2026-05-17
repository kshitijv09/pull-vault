import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "../../config/env";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function encryptionKey(): Buffer {
  const raw = process.env.AUCTION_SEALED_BID_ENCRYPTION_KEY?.trim();
  if (raw && raw.length >= 32) {
    return Buffer.from(raw.slice(0, 32), "utf8");
  }
  return scryptSync(env.jwtSecret, "pullvault:auction:sealed-bid", 32);
}

/** Format: base64(iv || ciphertext+tag) for storage in DB. */
export function encryptSealedBidAmountPlaintext(amountUsd: string): string {
  const key = encryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(amountUsd, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64");
}

export function decryptSealedBidAmountCiphertext(payloadB64: string): string {
  const buf = Buffer.from(payloadB64, "base64");
  if (buf.length < IV_LEN + 16) {
    throw new Error("Invalid sealed bid ciphertext");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(IV_LEN, buf.length - 16);
  const key = encryptionKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data, undefined, "utf8") + decipher.final("utf8");
}
