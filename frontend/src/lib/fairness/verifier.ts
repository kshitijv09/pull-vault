import Decimal from "decimal.js";
import {
  buildFairnessTranscriptMessage,
  parsePersistedTranscript
} from "./fairnessTranscript";
import { computePoolFingerprintHex, sha256OfHexBytes } from "./poolFingerprint";
import { asMathRandom, createSeededRng, hexToBytes } from "./seededRng";
import {
  StandardGenerationStrategy,
  type CandidateCard,
  type GeneratedPack
} from "./standardGenerationStrategy";
import type {
  PackFairnessPoolSnapshotResponse,
  PackFairnessRevealResponse
} from "./types";

export type VerifierCheckStatus = "pass" | "fail" | "skipped";

export interface VerifierCheck {
  id:
    | "server_commitment"
    | "pool_fingerprint_transcript"
    | "pool_fingerprint_recomputed"
    | "algorithm_supported"
    | "card_replay";
  label: string;
  status: VerifierCheckStatus;
  /** Human-readable detail explaining the verdict. */
  detail: string;
  /** Optional structured payload (e.g. expected vs actual hashes / ids). */
  evidence?: Record<string, unknown>;
}

export interface VerifiedPackCard {
  position: number;
  expectedCatalogCardId: string;
  actualCatalogCardId: string;
  match: boolean;
  name: string;
  rarity: string;
  marketValueUsd: string;
}

export interface VerifierResult {
  /** True only when every check passes AND every position matches the recorded outcome. */
  ok: boolean;
  checks: VerifierCheck[];
  cards: VerifiedPackCard[];
  /** The locally-derived `GeneratedPack` (for showing branch / total value). */
  generated?: GeneratedPack;
}

const SUPPORTED_ALGORITHM_VERSIONS = new Set<string>(["standard_v1"]);

/**
 * Run all Phase 4 browser-side checks for one user pack.
 *
 * Steps:
 *   1. `SHA256(server_secret) === server_commitment`   (Phase 1 binding)
 *   2. `transcript.pool_fingerprint === reveal.poolSnapshot.fingerprint`
 *   3. Recomputed fingerprint over the downloaded snapshot === both above
 *   4. `algorithm_version` is one this verifier supports
 *   5. Seed `StandardGenerationStrategy` with HMAC stream, compare derived
 *      ordered card ids vs `outcome.cards`.
 *
 * Every step is reported as a discrete `VerifierCheck` so the page can render
 * a transparent pass/fail trail.
 */
export async function verifyPackFairness(
  reveal: PackFairnessRevealResponse,
  snapshot: PackFairnessPoolSnapshotResponse
): Promise<VerifierResult> {
  const checks: VerifierCheck[] = [];

  const recomputedCommitment = await sha256OfHexBytes(reveal.phase2.serverSecretHex);
  const commitmentOk = recomputedCommitment === reveal.phase1.serverCommitmentHex.toLowerCase();
  checks.push({
    id: "server_commitment",
    label: "SHA-256(server_secret) matches the published commitment",
    status: commitmentOk ? "pass" : "fail",
    detail: commitmentOk
      ? "The server's revealed secret hashes to the commitment shown before purchase."
      : "Hash of the revealed server_secret does not match the published commitment.",
    evidence: {
      expected: reveal.phase1.serverCommitmentHex,
      actual: recomputedCommitment
    }
  });

  let transcript;
  try {
    transcript = parsePersistedTranscript(reveal.phase2.transcript);
  } catch (err) {
    return {
      ok: false,
      checks: [
        ...checks,
        {
          id: "pool_fingerprint_transcript",
          label: "Stored transcript is well-formed",
          status: "fail",
          detail: err instanceof Error ? err.message : "Transcript JSON is malformed."
        }
      ],
      cards: []
    };
  }

  const transcriptFingerprintOk =
    transcript.poolFingerprintHex.toLowerCase() ===
    reveal.poolSnapshot.fingerprintHex.toLowerCase();
  checks.push({
    id: "pool_fingerprint_transcript",
    label: "Transcript binds to the same pool fingerprint as the snapshot",
    status: transcriptFingerprintOk ? "pass" : "fail",
    detail: transcriptFingerprintOk
      ? "The pool fingerprint inside the HMAC transcript matches the snapshot header."
      : "Pool fingerprint in the transcript does not match the snapshot's published fingerprint.",
    evidence: {
      transcript: transcript.poolFingerprintHex,
      snapshot: reveal.poolSnapshot.fingerprintHex
    }
  });

  const recomputedSnapshotFingerprint = await computePoolFingerprintHex(
    snapshot.entries.map((entry) => ({
      id: entry.cardId,
      marketValueUsd: entry.marketValueUsdSnapshot
    }))
  );
  const snapshotFingerprintOk =
    recomputedSnapshotFingerprint === snapshot.fingerprintHex.toLowerCase();
  checks.push({
    id: "pool_fingerprint_recomputed",
    label: "Recomputed pool fingerprint matches the snapshot",
    status: snapshotFingerprintOk ? "pass" : "fail",
    detail: snapshotFingerprintOk
      ? "Hashing the ordered (card_id, market_value) pairs reproduces the published fingerprint."
      : "Locally recomputed fingerprint of the snapshot does not match its published value.",
    evidence: {
      recomputed: recomputedSnapshotFingerprint,
      published: snapshot.fingerprintHex
    }
  });

  const algorithmOk = SUPPORTED_ALGORITHM_VERSIONS.has(transcript.algorithmVersion);
  checks.push({
    id: "algorithm_supported",
    label: "Algorithm version is supported by this verifier",
    status: algorithmOk ? "pass" : "fail",
    detail: algorithmOk
      ? `Verifier knows how to replay '${transcript.algorithmVersion}'.`
      : `Verifier does not implement algorithm_version='${transcript.algorithmVersion}'.`,
    evidence: {
      transcript: transcript.algorithmVersion,
      supported: Array.from(SUPPORTED_ALGORITHM_VERSIONS)
    }
  });

  if (!commitmentOk || !transcriptFingerprintOk || !snapshotFingerprintOk || !algorithmOk) {
    checks.push({
      id: "card_replay",
      label: "Replayed pack contents match the recorded outcome",
      status: "skipped",
      detail: "Skipped because an upstream check failed."
    });
    return { ok: false, checks, cards: [] };
  }

  const candidates: CandidateCard[] = snapshot.entries.map((entry) => ({
    card: {
      id: entry.cardId,
      cardId: entry.externalCardId,
      name: entry.name,
      cardSet: entry.cardSet,
      imageUrl: entry.imageUrl,
      rarity: entry.rarity,
      marketValueUsd: entry.marketValueUsdSnapshot
    },
    marketValue: new Decimal(entry.marketValueUsdSnapshot)
  }));

  const targetPackValue = new Decimal(transcript.targetPackValueUsd);
  const retailPrice = new Decimal(transcript.retailPriceUsd);

  const message = buildFairnessTranscriptMessage(transcript);
  const serverSecret = hexToBytes(reveal.phase2.serverSecretHex);
  const rng = await createSeededRng(serverSecret, message);

  const strategy = new StandardGenerationStrategy();
  const generated = strategy.generateOnePack(
    candidates,
    targetPackValue,
    transcript.sequence,
    retailPrice,
    transcript.dryStreakSinceRetailWin,
    asMathRandom(rng)
  );

  const expectedIds = reveal.outcome.cards.map((c) => c.catalogCardId);
  const actualIds = generated.cards.map((c) => c.id);

  const length = Math.max(expectedIds.length, actualIds.length);
  const cards: VerifiedPackCard[] = [];
  let allMatch = expectedIds.length === actualIds.length;
  for (let i = 0; i < length; i += 1) {
    const expected = expectedIds[i] ?? "";
    const actual = actualIds[i] ?? "";
    const match = expected === actual && expected !== "";
    if (!match) allMatch = false;
    const sourceCard = generated.cards[i] ?? null;
    const fallback = reveal.outcome.cards[i] ?? null;
    cards.push({
      position: i + 1,
      expectedCatalogCardId: expected,
      actualCatalogCardId: actual,
      match,
      name: sourceCard?.name ?? fallback?.name ?? "Unknown",
      rarity: sourceCard?.rarity ?? fallback?.rarity ?? "—",
      marketValueUsd: sourceCard?.marketValueUsd ?? fallback?.marketValueUsd ?? "0.00"
    });
  }

  const replayDetail = allMatch
    ? `Replayed ${cards.length} cards; every catalog id matches the recorded outcome.`
    : `Replayed ${cards.length} cards; ${
        cards.filter((c) => !c.match).length
      } position(s) do not match the recorded outcome.`;

  checks.push({
    id: "card_replay",
    label: "Replayed pack contents match the recorded outcome",
    status: allMatch ? "pass" : "fail",
    detail: replayDetail,
    evidence: {
      branch: generated.branch,
      totalValueUsd: generated.totalValueUsd,
      expected: expectedIds,
      actual: actualIds
    }
  });

  return {
    ok: checks.every((c) => c.status === "pass"),
    checks,
    cards,
    generated
  };
}
