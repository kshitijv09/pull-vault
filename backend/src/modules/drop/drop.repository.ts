import { getClient, query } from "../../db";
import {
  CreateDropInput,
  Drop,
  DropWithPacks,
  Pack,
  PackDropSummary,
  PackDropPurchaseRequest
} from "./drop.types";
import type { PackRemainingSeedRow, TierQueueSeed } from "../../infra/redis/shardedRedisPackCounter";

export class DropRepository {
  async create(input: CreateDropInput): Promise<Drop> {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      const dropResult = await client.query(
        `
          INSERT INTO drops (name, start_time, duration_minutes, status)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `,
        [input.name, input.startTime, input.durationMinutes, input.status || "upcoming"]
      );
      const drop = this.mapDropRow(dropResult.rows[0]);

      for (const tier of input.tiers) {
        if (tier.packCount <= 0) {
          continue;
        }

        const candidates = await client.query<{ id: string }>(
          `
            SELECT p.id
            FROM packs p
            WHERE lower(p.tier_name) = lower($1)
            ORDER BY p.id ASC
          `,
          [tier.tierName]
        );

        if (candidates.rows.length === 0) {
          throw new Error(
            `No packs available for tier '${tier.tierName}'.`
          );
        }

        for (let i = 0; i < tier.packCount; i += 1) {
          const row = candidates.rows[Math.floor(Math.random() * candidates.rows.length)];
          await client.query(
            `
              INSERT INTO pack_inventory (pack_id, drop_id, status)
              VALUES ($1::uuid, $2::uuid, 'available')
            `,
            [row.id, drop.id]
          );
        }
      }

      await client.query("COMMIT");
      return drop;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findAllWithPacks(): Promise<DropWithPacks[]> {
    const dropsRes = await query(`SELECT * FROM drops ORDER BY start_time ASC`);
    const packsRes = await query(`
      SELECT 
        MIN(p.id::text)::uuid AS id,
        p.tier_name, p.price::text as price, p.cards_per_pack,
        COUNT(pi2.id)::int AS available_count,
        p.start_time,
        p.rarity_weights, d.id AS drop_id, p.created_at, p.updated_at
      FROM drops d
      INNER JOIN pack_inventory pi2 ON pi2.drop_id = d.id AND pi2.status = 'available'
      INNER JOIN packs p ON p.id = pi2.pack_id
      GROUP BY d.id, p.tier_name, p.price, p.cards_per_pack, p.start_time, p.rarity_weights, p.created_at, p.updated_at
    `);
    
    const drops = dropsRes.rows.map(row => this.mapDropRow(row));
    const packs = packsRes.rows;
    
    return drops.map(drop => ({
      ...drop,
      packs: packs.filter(p => p.drop_id === drop.id).map(p => this.mapPackRow(p))
    }));
  }

  async findAllPacksOrdered(): Promise<Pack[]> {
    const result = await query(`
      SELECT
        MIN(p.id::text)::uuid AS id, p.tier_name, p.price::text AS price, p.cards_per_pack,
        COUNT(pi2.id)::int AS available_count,
        p.start_time,
        p.rarity_weights, p.created_at, p.updated_at
      FROM packs p
      INNER JOIN pack_inventory pi2 ON pi2.pack_id = p.id AND pi2.status = 'available' AND pi2.drop_id IS NOT NULL
      GROUP BY p.tier_name, p.price, p.cards_per_pack, p.start_time, p.rarity_weights, p.created_at, p.updated_at
      ORDER BY p.start_time ASC, p.tier_name ASC
    `);
    return result.rows.map((row) => this.mapPackRow(row));
  }

  async listScheduledDrops(): Promise<PackDropSummary[]> {
    const packs = await this.findAllPacksOrdered();
    return packs.map((pack) => ({
      id: pack.id,
      tier: pack.tierName,
      startsAt: pack.dropStartsAt,
      availableCount: pack.availableCount,
      packPriceUsd: pack.priceUsd
    }));
  }

  async createPurchase(_input: PackDropPurchaseRequest): Promise<void> {
    return;
  }

  async findDropById(
    dropId: string
  ): Promise<{ id: string; name: string; startTime: string; durationMinutes: number; status: string } | null> {
    const result = await query<{
      id: string;
      name: string;
      start_time: Date | string;
      duration_minutes: number;
      status: string;
    }>(
      `
        SELECT id, name, start_time, duration_minutes, status
        FROM drops
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [dropId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      startTime: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
      durationMinutes: row.duration_minutes,
      status: row.status
    };
  }

  async updateDropStatus(dropId: string, status: "upcoming" | "live" | "ended"): Promise<void> {
    await query(
      `
        UPDATE drops
        SET status = $2
        WHERE id = $1::uuid
      `,
      [dropId, status]
    );
  }

  async getTierSeedDataForDrop(dropId: string): Promise<{
    rows: PackRemainingSeedRow[];
    tierQueues: TierQueueSeed[];
  }> {
    const result = await query<{
      inventory_id: string;
      drop_id: string;
      tier_name: string;
    }>(
      `
        SELECT
          pi.id AS inventory_id,
          pi.drop_id,
          p.tier_name
        FROM pack_inventory pi
        INNER JOIN packs p ON p.id = pi.pack_id
        WHERE pi.drop_id = $1::uuid
          AND pi.status = 'available'
        ORDER BY p.tier_name ASC, pi.created_at ASC, pi.id ASC
      `,
      [dropId]
    );

    const rows: PackRemainingSeedRow[] = [];
    const groupedByTier = new Map<string, string[]>();
    for (const row of result.rows) {
      rows.push({
        packId: row.inventory_id,
        dropId: row.drop_id,
        tierName: row.tier_name,
        remaining: 1
      });
      const existing = groupedByTier.get(row.tier_name);
      if (existing) {
        existing.push(row.inventory_id);
      } else {
        groupedByTier.set(row.tier_name, [row.inventory_id]);
      }
    }

    const tierQueues: TierQueueSeed[] = [];
    for (const [tierName, orderedPackIds] of groupedByTier) {
      tierQueues.push({ dropId, tierName, orderedPackIds });
    }

    return { rows, tierQueues };
  }

  async findNextNonCompletedDrop(): Promise<{
    id: string;
    name: string;
    startTime: string;
    status: string;
  } | null> {
    const result = await query<{
      id: string;
      name: string;
      start_time: Date;
      status: string;
    }>(
      `
        SELECT id, name, start_time, status
        FROM drops
        WHERE lower(status) <> 'completed'
        ORDER BY start_time ASC
        LIMIT 1
      `
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      startTime: row.start_time.toISOString(),
      status: row.status
    };
  }

  async findDropsReadyToStart(nowIso: string): Promise<string[]> {
    const result = await query<{ id: string }>(
      `
        SELECT id
        FROM drops
        WHERE lower(status) = 'upcoming'
          AND start_time <= $1::timestamptz
        ORDER BY start_time ASC
      `,
      [nowIso]
    );
    return result.rows.map((row) => row.id);
  }

  async findDropsReadyToEnd(nowIso: string): Promise<string[]> {
    const result = await query<{ id: string }>(
      `
        SELECT id
        FROM drops
        WHERE lower(status) = 'live'
          AND (start_time + make_interval(mins => duration_minutes)) <= $1::timestamptz
        ORDER BY start_time ASC
      `,
      [nowIso]
    );
    return result.rows.map((row) => row.id);
  }

  private mapDropRow(row: any): Drop {
    return {
      id: row.id,
      name: row.name,
      startTime: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
      durationMinutes: row.duration_minutes,
      status: row.status,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
    };
  }

  private mapPackRow(row: any): Pack {
    return {
      id: row.id,
      tierName: row.tier_name,
      priceUsd: row.price,
      cardsPerPack: row.cards_per_pack,
      availableCount: row.available_count,
      dropStartsAt: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
      rarityWeights: this.normalizeRarityWeights(row.rarity_weights),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
    };
  }

  private normalizeRarityWeights(value: Record<string, unknown>): Record<string, number> {
    const out: Record<string, number> = {};
    if (value) {
      for (const [key, raw] of Object.entries(value)) {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (Number.isFinite(n)) {
          out[key] = n;
        }
      }
    }
    return out;
  }
}
