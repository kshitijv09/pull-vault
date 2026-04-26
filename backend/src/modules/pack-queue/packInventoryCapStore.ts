import { query } from "../../db";
import type { PackRemainingSeedRow, TierQueueSeed } from "../../infra/redis/shardedRedisPackCounter";

interface PackRow {
  inventory_id: string;
  drop_id: string;
  tier_name: string;
}

/** `${dropId}\0${tierName}` → ordered pack ids (same tier = sequential assignment order). */
const tierOrderedPackIds = new Map<string, string[]>();
let seedRows: PackRemainingSeedRow[] = [];
let tierQueueSeeds: TierQueueSeed[] = [];

function tierKey(dropId: string, tierName: string): string {
  return `${dropId.trim().toLowerCase()}\0${tierName.trim().toLowerCase()}`;
}

/**
 * Loads pack rows: ordered pack ids per (drop, tier_name) and seed rows for Redis `remaining` keys.
 */
export async function prefetchPackInventoryCaps(): Promise<void> {
  const result = await query<PackRow>(
    `
      SELECT
        pi.id AS inventory_id,
        pi.drop_id,
        p.tier_name
      FROM pack_inventory pi
      INNER JOIN packs p ON p.id = pi.pack_id
      WHERE pi.drop_id IS NOT NULL
        AND pi.status = 'available'
      ORDER BY pi.drop_id, p.tier_name, pi.created_at, pi.id
    `
  );

  tierOrderedPackIds.clear();
  seedRows = [];
  tierQueueSeeds = [];

  for (const row of result.rows) {
    const key = tierKey(row.drop_id, row.tier_name);
    const list = tierOrderedPackIds.get(key);
    if (list) {
      list.push(row.inventory_id);
    } else {
      tierOrderedPackIds.set(key, [row.inventory_id]);
    }

    seedRows.push({
      packId: row.inventory_id,
      dropId: row.drop_id,
      tierName: row.tier_name,
      remaining: 1
    });
  }

  for (const [key, orderedPackIds] of tierOrderedPackIds) {
    const sep = key.indexOf("\0");
    const dropId = key.slice(0, sep);
    const tierName = key.slice(sep + 1);
    tierQueueSeeds.push({ dropId, tierName, orderedPackIds: [...orderedPackIds] });
  }

}

export function getPackSeedRows(): PackRemainingSeedRow[] {
  return seedRows;
}

/** Ordered tiers + pack ids for seeding Redis LIST keys. */
export function getTierQueueSeedsForRedis(): TierQueueSeed[] {
  return tierQueueSeeds;
}

/**
 * Ordered catalog pack ids for a drop + tier name (`packs.tier_name`).
 * Used to validate the tier exists before hitting Redis.
 */
export function getOrderedPackIdsForTier(dropId: string, tierName: string): string[] {
  const key = tierKey(dropId, tierName.trim());
  return tierOrderedPackIds.get(key) ?? [];
}
