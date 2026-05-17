import Decimal from "decimal.js";
import { AppError } from "../../shared/errors/AppError";
import {
  PACK_FAIRNESS_MODE,
  PACK_FAIRNESS_DEFAULT_ALGORITHM_VERSION
} from "../../shared/constants/packFairnessCommit.constants";
import {
  packGeneratorConfig
} from "../../modules/pack-generator/packGenerator.config";
import { StandardGenerationStrategy } from "../../modules/pack-generator/strategies/StandardGenerationStrategy";
import type { CandidateCard } from "../../modules/pack-generator/strategies/PackGenerationStrategy";
import {
  asMathRandom,
  computePoolFingerprintHex,
  createSeededRng
} from "../../shared/crypto/seededRng";
import {
  buildFairnessTranscriptMessage,
  serializeFairnessTranscript,
  type FairnessTranscriptInputs
} from "../../shared/crypto/fairnessTranscript";
import { DropCardPoolSnapshotRepository } from "../../modules/drop/dropCardPoolSnapshot.repository";
import type {
  CatalogCardRow,
  FulfillmentInputs,
  FulfillmentResult,
  PackFulfillmentStrategy
} from "./PackFulfillmentStrategy";

interface FairnessCommitRow {
  id: string;
  client_seed: string;
  server_secret_hex: string;
  consumed_at: string | null;
}

/**
 * Phase 2 provably-fair fulfillment.
 *
 * Inside the consumer's transaction this strategy:
 *   1. Locks the Phase 1 `pack_fairness_commit` row matching the buyer's nonce.
 *   2. Snapshots the ordered catalog card pool and computes `pool_fingerprint`.
 *   3. Builds the canonical transcript message bound to this purchase
 *      (`user_pack_id`, `pack_inventory.id`, drop, retail/TPV, fingerprint).
 *   4. Seeds an HMAC-SHA256 stream keyed by `server_secret`.
 *   5. Runs `StandardGenerationStrategy` with that stream replacing
 *      `Math.random()` — the existing anchor / stabilizer / bulk rules are
 *      unchanged.
 *   6. Stamps the commit row `consumed_at`, links `user_pack_id`, and records
 *      `pool_fingerprint`, `algorithm_version`, and the transcript inputs for
 *      Phase 3 reveal.
 */
export class FairnessPackFulfillment implements PackFulfillmentStrategy {
  public readonly name = PACK_FAIRNESS_MODE.FAIRNESS;

  private readonly generationStrategy = new StandardGenerationStrategy();
  private readonly poolSnapshotRepository = new DropCardPoolSnapshotRepository();

  async fulfill(inputs: FulfillmentInputs): Promise<FulfillmentResult> {
    const { client, userId, dropId, pack, userPackId, nonce } = inputs;

    if (!nonce) {
      throw new AppError(
        "Fairness session nonce is required for provably-fair drops.",
        400
      );
    }

    const commitResult = await client.query<FairnessCommitRow>(
      `
        SELECT id, client_seed, server_secret_hex, consumed_at
        FROM pack_fairness_commit
        WHERE id = $1::uuid
          AND user_id = $2::uuid
          AND drop_id = $3::uuid
        FOR UPDATE
      `,
      [nonce, userId, dropId]
    );
    const commit = commitResult.rows[0];
    if (!commit) {
      throw new AppError("Fairness session not found for this user and drop.", 404);
    }
    if (commit.consumed_at) {
      throw new AppError("Fairness session has already been consumed.", 409);
    }

    const snapshot = await this.poolSnapshotRepository.ensureForDrop(client, dropId);

    if (snapshot.entries.length < pack.cardsPerPack) {
      throw new AppError(
        `Pool snapshot is too small (${snapshot.entries.length}) for cards_per_pack=${pack.cardsPerPack}.`,
        500
      );
    }

    const recomputedFingerprint = computePoolFingerprintHex(
      snapshot.entries.map((row) => ({ id: row.cardId, marketValueUsd: row.marketValueUsdSnapshot }))
    );
    if (recomputedFingerprint !== snapshot.fingerprintHex) {
      throw new AppError(
        "Pool snapshot fingerprint mismatch; refusing to derive cards.",
        500
      );
    }

    const candidates: CandidateCard[] = snapshot.entries.map((row) => ({
      card: {
        id: row.cardId,
        cardId: row.externalCardId,
        name: row.name,
        cardSet: row.cardSet,
        imageUrl: row.imageUrl,
        rarity: row.rarity,
        marketValueUsd: row.marketValueUsdSnapshot
      },
      marketValue: new Decimal(row.marketValueUsdSnapshot)
    }));

    const poolFingerprintHex = snapshot.fingerprintHex;

    const retailPrice = pack.packPriceUsd;
    const targetPackValue = retailPrice
      .mul(packGeneratorConfig.targetPackValueRatio)
      .toDecimalPlaces(2);

    const algorithmVersion =
      pack.fairnessAlgorithmVersion || PACK_FAIRNESS_DEFAULT_ALGORITHM_VERSION;

    const transcriptInputs: FairnessTranscriptInputs = {
      algorithmVersion,
      nonce: commit.id,
      clientSeed: commit.client_seed,
      dropId,
      userPackId,
      packInventoryId: pack.inventoryId,
      poolFingerprintHex,
      targetPackValueUsd: targetPackValue.toDecimalPlaces(2).toFixed(2),
      retailPriceUsd: retailPrice.toDecimalPlaces(2).toFixed(2),
      sequence: 1,
      dryStreakSinceRetailWin: 0
    };

    const message = buildFairnessTranscriptMessage(transcriptInputs);
    const rng = createSeededRng(Buffer.from(commit.server_secret_hex, "hex"), message);

    const generated = this.generationStrategy.generateOnePack(
      candidates,
      targetPackValue,
      transcriptInputs.sequence,
      retailPrice,
      transcriptInputs.dryStreakSinceRetailWin,
      asMathRandom(rng)
    );

    if (generated.cards.length !== pack.cardsPerPack) {
      throw new AppError(
        `Fairness derivation produced ${generated.cards.length} cards; expected ${pack.cardsPerPack}.`,
        500
      );
    }

    const update = await client.query<{ id: string }>(
      `
        UPDATE pack_fairness_commit
        SET
          consumed_at = NOW(),
          user_pack_id = $2::uuid,
          pool_fingerprint_hex = $3,
          algorithm_version = $4,
          transcript = $5::jsonb
        WHERE id = $1::uuid AND consumed_at IS NULL
        RETURNING id
      `,
      [
        commit.id,
        userPackId,
        poolFingerprintHex,
        algorithmVersion,
        JSON.stringify(serializeFairnessTranscript(transcriptInputs))
      ]
    );

    if (update.rows.length === 0) {
      throw new AppError(
        "Fairness session was consumed concurrently; please retry the purchase.",
        409
      );
    }

    const cards: CatalogCardRow[] = generated.cards.map((c) => ({
      id: c.id,
      card_id: c.cardId,
      name: c.name,
      card_set: c.cardSet,
      rarity: c.rarity,
      market_value_usd: c.marketValueUsd,
      image_url: c.imageUrl ?? null
    }));

    return { cards };
  }
}
