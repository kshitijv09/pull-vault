import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/AppError";
import { PACK_FAIRNESS_MODE } from "../../shared/constants/packFairnessCommit.constants";
import { DropCardPoolSnapshotRepository } from "./dropCardPoolSnapshot.repository";
import { PackFairnessRevealRepository } from "./packFairnessReveal.repository";
import type {
  PackFairnessPoolSnapshotResponse,
  PackFairnessRevealOutcomeCard,
  PackFairnessRevealResponse
} from "./packFairnessReveal.types";

/**
 * Phase 3: returns every input the browser verifier needs to reproduce the
 * Phase 2 derivation. Authorization is per-buyer (the caller must own the
 * `user_packs` row). Before returning the server runs an integrity check
 * `SHA256(server_secret_hex) === server_commitment_hex` so a corrupted row
 * surfaces as 500 instead of silently shipping unverifiable data.
 */
export class PackFairnessRevealService {
  constructor(
    private readonly revealRepository: PackFairnessRevealRepository,
    private readonly poolSnapshotRepository: DropCardPoolSnapshotRepository
  ) {}

  /**
   * REQ §B4: "any user can check any past pack opening". Once a commit is
   * `consumed_at`, the `server_secret` is no longer a secret (the whole point
   * of reveal), so the route is intentionally **public** for consumed packs.
   * For not-yet-consumed packs we still require ownership so a user can't
   * peek at someone else's in-flight purchase before fulfillment lands.
   */
  async revealForUserPack(
    userPackId: string,
    requesterUserId: string | null
  ): Promise<PackFairnessRevealResponse> {
    const id = userPackId.trim();
    if (!id) {
      throw new AppError("userPackId is required.", 400);
    }

    const header = await this.revealRepository.findHeader(id);
    if (!header) {
      throw new AppError("Pack not found.", 404);
    }

    if (header.fairness_mode !== PACK_FAIRNESS_MODE.FAIRNESS) {
      throw new AppError("This pack is not provably fair; no reveal data available.", 404);
    }

    if (!header.consumed_at) {
      if (!requesterUserId || header.user_id !== requesterUserId) {
        throw new AppError("Pack not found.", 404);
      }
      throw new AppError("Fairness commit has not been consumed yet.", 409);
    }

    if (
      !header.commit_id ||
      !header.client_seed ||
      !header.server_secret_hex ||
      !header.server_commitment_hex ||
      !header.pool_fingerprint_hex ||
      !header.algorithm_version ||
      !header.transcript
    ) {
      throw new AppError("Fairness commit is incomplete for this pack.", 409);
    }

    const recomputedCommitment = createHash("sha256")
      .update(Buffer.from(header.server_secret_hex, "hex"))
      .digest("hex");
    if (recomputedCommitment !== header.server_commitment_hex) {
      console.error("[packFairnessReveal] server_commitment integrity check failed", {
        userPackId: id,
        commitId: header.commit_id
      });
      throw new AppError("Fairness commit integrity check failed.", 500);
    }

    const cardRows = await this.revealRepository.findOutcomeCards(id);
    if (cardRows.length === 0) {
      throw new AppError("No outcome cards recorded for this pack.", 500);
    }

    const cards: PackFairnessRevealOutcomeCard[] = cardRows.map((row) => ({
      catalogCardId: row.catalog_card_id,
      externalCardId: row.external_card_id,
      name: row.name,
      cardSet: row.card_set,
      rarity: row.rarity,
      imageUrl: row.image_url,
      marketValueUsd: row.market_value_usd,
      acquisitionPriceUsd: row.acquisition_price_usd
    }));

    const seedSource =
      header.client_seed_source === "user" ? "user" : "server";

    return {
      userPackId: header.user_pack_id,
      dropId: header.drop_id,
      packInventoryId: header.pack_inventory_id,
      fairnessMode: PACK_FAIRNESS_MODE.FAIRNESS,
      algorithmVersion: header.algorithm_version,
      consumedAt: header.consumed_at,
      phase1: {
        nonce: header.commit_id,
        clientSeed: header.client_seed,
        clientSeedSource: seedSource,
        serverCommitmentHex: header.server_commitment_hex
      },
      phase2: {
        serverSecretHex: header.server_secret_hex,
        poolFingerprintHex: header.pool_fingerprint_hex,
        transcript: header.transcript
      },
      outcome: { cards },
      poolSnapshot: {
        url: `/drops/${header.drop_id}/fairness-pool-snapshot`,
        fingerprintHex: header.pool_fingerprint_hex,
        createdAt: header.pool_snapshot_created_at ?? header.consumed_at
      }
    };
  }

  async getPoolSnapshot(dropId: string): Promise<PackFairnessPoolSnapshotResponse> {
    const id = dropId.trim();
    if (!id) {
      throw new AppError("dropId is required.", 400);
    }
    const snapshot = await this.poolSnapshotRepository.readForDrop(id);
    return {
      dropId: snapshot.dropId,
      fingerprintHex: snapshot.fingerprintHex,
      createdAt: snapshot.createdAt,
      entries: snapshot.entries
    };
  }
}
