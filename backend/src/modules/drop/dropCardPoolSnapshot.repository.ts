import type { PoolClient } from "pg";
import { query as poolQuery } from "../../db";
import { AppError } from "../../shared/errors/AppError";
import { computePoolFingerprintHex } from "../../shared/crypto/seededRng";
import type { DropCardPoolSnapshot, DropCardPoolSnapshotEntry } from "./dropCardPoolSnapshot.types";

interface SnapshotJoinedRow {
  pool_index: number;
  card_id: string;
  market_value_usd_snapshot: string;
  external_card_id: string;
  name: string;
  card_set: string;
  rarity: string;
  image_url: string;
}

interface LiveCatalogRow {
  id: string;
  card_id: string;
  name: string;
  card_set: string;
  rarity: string;
  image_url: string;
  market_value_usd: string;
}

/**
 * Per-drop ordered catalog pool snapshot. The first provably-fair purchase
 * triggers creation via double-checked locking on the `drops` row; later
 * purchases read the existing snapshot. Verifiers download it to reproduce
 * the pool fingerprint and re-run the strategy independently.
 */
export class DropCardPoolSnapshotRepository {
  /**
   * Idempotently ensure a snapshot exists for the drop and return the ordered
   * entries plus the stored fingerprint. Must be called inside a transaction.
   */
  async ensureForDrop(client: PoolClient, dropId: string): Promise<DropCardPoolSnapshot> {
    const fastFingerprint = await this.readDropFingerprint(client, dropId);
    if (fastFingerprint) {
      return this.readSnapshot(client, dropId, fastFingerprint);
    }

    const lockResult = await client.query<{
      id: string;
      pool_snapshot_fingerprint_hex: string | null;
    }>(
      `
        SELECT id, pool_snapshot_fingerprint_hex
        FROM drops
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [dropId]
    );
    if (lockResult.rows.length === 0) {
      throw new AppError("Drop not found.", 404);
    }
    const existing = lockResult.rows[0].pool_snapshot_fingerprint_hex;
    if (existing) {
      return this.readSnapshot(client, dropId, existing);
    }

    return this.createSnapshot(client, dropId);
  }

  /** Fetch an existing snapshot without locking; throws if none exists. */
  async readForDrop(dropId: string): Promise<DropCardPoolSnapshot> {
    const dropResult = await poolQuery<{ pool_snapshot_fingerprint_hex: string | null }>(
      `SELECT pool_snapshot_fingerprint_hex FROM drops WHERE id = $1::uuid LIMIT 1`,
      [dropId]
    );
    const row = dropResult.rows[0];
    if (!row) {
      throw new AppError("Drop not found.", 404);
    }
    if (!row.pool_snapshot_fingerprint_hex) {
      throw new AppError("Pool snapshot has not been created for this drop yet.", 404);
    }
    return this.readSnapshotWithPool(dropId, row.pool_snapshot_fingerprint_hex);
  }

  private async readDropFingerprint(client: PoolClient, dropId: string): Promise<string | null> {
    const result = await client.query<{ pool_snapshot_fingerprint_hex: string | null }>(
      `SELECT pool_snapshot_fingerprint_hex FROM drops WHERE id = $1::uuid LIMIT 1`,
      [dropId]
    );
    if (result.rows.length === 0) {
      throw new AppError("Drop not found.", 404);
    }
    return result.rows[0].pool_snapshot_fingerprint_hex;
  }

  private async readSnapshot(
    client: PoolClient,
    dropId: string,
    fingerprintHex: string
  ): Promise<DropCardPoolSnapshot> {
    const rows = await client.query<SnapshotJoinedRow & { snapshot_created_at: string }>(
      `
        SELECT
          s.pool_index,
          s.card_id,
          s.market_value_usd_snapshot::text AS market_value_usd_snapshot,
          c.card_id AS external_card_id,
          c.name,
          c.card_set,
          c.rarity,
          c.image_url,
          d.pool_snapshot_created_at::text AS snapshot_created_at
        FROM drop_card_pool_snapshot s
        INNER JOIN card c ON c.id = s.card_id
        INNER JOIN drops d ON d.id = s.drop_id
        WHERE s.drop_id = $1::uuid
        ORDER BY s.pool_index ASC
      `,
      [dropId]
    );

    if (rows.rows.length === 0) {
      throw new AppError("Pool snapshot row set is empty; refusing to derive cards.", 500);
    }

    const entries: DropCardPoolSnapshotEntry[] = rows.rows.map((r) => ({
      poolIndex: r.pool_index,
      cardId: r.card_id,
      externalCardId: r.external_card_id,
      name: r.name,
      cardSet: r.card_set,
      rarity: r.rarity,
      imageUrl: r.image_url,
      marketValueUsdSnapshot: r.market_value_usd_snapshot
    }));

    return {
      dropId,
      fingerprintHex,
      createdAt: rows.rows[0].snapshot_created_at,
      entries
    };
  }

  private async readSnapshotWithPool(
    dropId: string,
    fingerprintHex: string
  ): Promise<DropCardPoolSnapshot> {
    const rows = await poolQuery<SnapshotJoinedRow & { snapshot_created_at: string }>(
      `
        SELECT
          s.pool_index,
          s.card_id,
          s.market_value_usd_snapshot::text AS market_value_usd_snapshot,
          c.card_id AS external_card_id,
          c.name,
          c.card_set,
          c.rarity,
          c.image_url,
          d.pool_snapshot_created_at::text AS snapshot_created_at
        FROM drop_card_pool_snapshot s
        INNER JOIN card c ON c.id = s.card_id
        INNER JOIN drops d ON d.id = s.drop_id
        WHERE s.drop_id = $1::uuid
        ORDER BY s.pool_index ASC
      `,
      [dropId]
    );

    if (rows.rows.length === 0) {
      throw new AppError("Pool snapshot row set is empty.", 500);
    }

    const entries: DropCardPoolSnapshotEntry[] = rows.rows.map((r) => ({
      poolIndex: r.pool_index,
      cardId: r.card_id,
      externalCardId: r.external_card_id,
      name: r.name,
      cardSet: r.card_set,
      rarity: r.rarity,
      imageUrl: r.image_url,
      marketValueUsdSnapshot: r.market_value_usd_snapshot
    }));

    return {
      dropId,
      fingerprintHex,
      createdAt: rows.rows[0].snapshot_created_at,
      entries
    };
  }

  private async createSnapshot(client: PoolClient, dropId: string): Promise<DropCardPoolSnapshot> {
    const live = await client.query<LiveCatalogRow>(
      `
        SELECT
          c.id,
          c.card_id,
          c.name,
          c.card_set,
          c.rarity,
          c.image_url,
          c.market_value_usd::text AS market_value_usd
        FROM card c
        ORDER BY c.market_value_usd DESC, c.id ASC
      `
    );

    if (live.rows.length === 0) {
      throw new AppError("Catalog is empty; cannot snapshot pool for fairness drop.", 500);
    }

    const valuesSql: string[] = [];
    const params: unknown[] = [dropId];
    let p = 2;
    for (let i = 0; i < live.rows.length; i += 1) {
      valuesSql.push(`($1::uuid, $${p}::int, $${p + 1}::uuid, $${p + 2}::numeric)`);
      params.push(i, live.rows[i].id, live.rows[i].market_value_usd);
      p += 3;
    }

    await client.query(
      `
        INSERT INTO drop_card_pool_snapshot (drop_id, pool_index, card_id, market_value_usd_snapshot)
        VALUES ${valuesSql.join(", ")}
      `,
      params
    );

    const fingerprintHex = computePoolFingerprintHex(
      live.rows.map((row) => ({ id: row.id, marketValueUsd: row.market_value_usd }))
    );

    const update = await client.query<{ pool_snapshot_created_at: string }>(
      `
        UPDATE drops
        SET
          pool_snapshot_fingerprint_hex = $2,
          pool_snapshot_created_at = NOW()
        WHERE id = $1::uuid
        RETURNING pool_snapshot_created_at::text AS pool_snapshot_created_at
      `,
      [dropId, fingerprintHex]
    );
    if (update.rows.length === 0) {
      throw new AppError("Failed to record pool snapshot fingerprint on drop.", 500);
    }

    const entries: DropCardPoolSnapshotEntry[] = live.rows.map((r, idx) => ({
      poolIndex: idx,
      cardId: r.id,
      externalCardId: r.card_id,
      name: r.name,
      cardSet: r.card_set,
      rarity: r.rarity,
      imageUrl: r.image_url,
      marketValueUsdSnapshot: r.market_value_usd
    }));

    return {
      dropId,
      fingerprintHex,
      createdAt: update.rows[0].pool_snapshot_created_at,
      entries
    };
  }
}
