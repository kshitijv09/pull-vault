import { readFileSync } from "node:fs";
import { join } from "node:path";
import Redis from "ioredis";
import { env } from "../../config/env";

export type ReserveFromTierListResult =
  | { ok: true; packId: string; newRemaining: number; shardIndex: number }
  | { ok: false; reason: "sold_out" | "not_configured" | "wallet_missing" | "insufficient_balance" };

export interface PackRemainingSeedRow {
  packId: string;
  dropId: string;
  tierName: string;
  remaining: number;
}

export interface TierQueueSeed {
  dropId: string;
  tierName: string;
  orderedPackIds: string[];
}

function stableStringHash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return Math.abs(hash);
}

/** One Redis key per catalog pack row; remaining slots to assign for that pack line. */
export function packRemainingKey(packId: string): string {
  return `pullvault:pack:${packId}:remaining`;
}

/**
 * Redis LIST of pack ids for a tier that still have remaining > 0 (head = current line to drain).
 * Stale entries are removed by the reserve Lua when GET remaining is 0.
 */
export function tierAvailableListKey(dropId: string, tierName: string): string {
  return `pullvault:tier:${dropId.trim()}:${tierName.trim()}:available`;
}

/**
 * Routes a tier (drop + tier name) to a shard so list + pack keys for that tier live on one Redis.
 */
export class ShardedRedisPackCounter {
  private readonly clients: Redis[];
  private readonly reserveFromListScript: string;

  constructor(shardUrls: string[] = env.redisShardUrls) {
    this.clients = shardUrls.map((url) => new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true }));
    this.reserveFromListScript = readFileSync(
      join(__dirname, "lua", "reserve_from_tier_available_list.lua"),
      "utf8"
    );
  }

  isConfigured(): boolean {
    return this.clients.length > 0;
  }

  pickShardIndexForTier(dropId: string, tierName: string): number {
    if (this.clients.length === 0) {
      return 0;
    }
    return stableStringHash(`${dropId}\0${tierName}`) % this.clients.length;
  }

  /**
   * Seeds per-pack remaining counters and builds each tier's available-pack LIST (only packs with remaining > 0).
   */
  async seedPackRemaining(rows: PackRemainingSeedRow[], tierQueues: TierQueueSeed[]): Promise<void> {
    if (this.clients.length === 0) {
      return;
    }

    const remainingByPackId = new Map<string, number>();
    for (const row of rows) {
      if (!Number.isFinite(row.remaining) || row.remaining < 0) {
        continue;
      }
      const n = Math.floor(row.remaining);
      remainingByPackId.set(row.packId, n);
      const shardIndex = this.pickShardIndexForTier(row.dropId, row.tierName);
      const redis = this.clients[shardIndex];
      await redis.set(packRemainingKey(row.packId), String(n));
    }

    for (const tier of tierQueues) {
      const shardIndex = this.pickShardIndexForTier(tier.dropId, tier.tierName);
      const redis = this.clients[shardIndex];
      const listKey = tierAvailableListKey(tier.dropId, tier.tierName);
      const idsInOrder = tier.orderedPackIds.filter((id) => (remainingByPackId.get(id) ?? 0) > 0);

      await redis.del(listKey);
      if (idsInOrder.length > 0) {
        await redis.rpush(listKey, ...idsInOrder);
      }
    }
  }

  /**
   * Atomically reserves one unit from the head of the tier list (or next non-stale head) and updates remaining.
   */
  async tryReserveFromTierAvailableList(
    dropId: string,
    tierName: string,
    requiredAmountUsd: string,
    cachedWalletBalanceUsd: string
  ): Promise<ReserveFromTierListResult> {
    if (this.clients.length === 0) {
      return { ok: false, reason: "not_configured" };
    }

    const shardIndex = this.pickShardIndexForTier(dropId, tierName);
    const redis = this.clients[shardIndex];
    const listKey = tierAvailableListKey(dropId, tierName);
    const raw = await redis.eval(
      this.reserveFromListScript,
      1,
      listKey,
      env.packTierUpdatesChannel,
      requiredAmountUsd,
      cachedWalletBalanceUsd
    );

    const tuple = Array.isArray(raw) ? raw : [raw];

    if (tuple.length < 2) {
      const code = typeof tuple[0] === "number" ? tuple[0] : Number(tuple[0]);
      if (code === -2) {
        return { ok: false, reason: "wallet_missing" };
      }
      if (code === -3) {
        return { ok: false, reason: "insufficient_balance" };
      }
      if (code === -1 || Number.isNaN(code)) {
        return { ok: false, reason: "sold_out" };
      }
      return { ok: false, reason: "sold_out" };
    }

    const packId = String(tuple[0]);
    const newRemainingRaw = tuple[1];
    const newRemaining =
      typeof newRemainingRaw === "number" ? newRemainingRaw : Number(newRemainingRaw);

    if (!packId || packId === "-1" || !Number.isFinite(newRemaining)) {
      return { ok: false, reason: "sold_out" };
    }

    return {
      ok: true,
      packId,
      newRemaining,
      shardIndex
    };
  }

  /**
   * Ordered pack ids currently present in the tier available LIST.
   * Used as fallback when in-memory prefetch is missing.
   */
  async getOrderedPackIdsForTier(dropId: string, tierName: string): Promise<string[]> {
    if (this.clients.length === 0) {
      return [];
    }
    const shardIndex = this.pickShardIndexForTier(dropId, tierName);
    const redis = this.clients[shardIndex];
    const listKey = tierAvailableListKey(dropId, tierName);
    return await redis.lrange(listKey, 0, -1);
  }

  /**
   * Undo reserve after failed enqueue or processing: INCR remaining; if it becomes 1, it was previously 0
   * which means it was removed from the list, so LPUSH it back to the head.
   */
  async releaseReservation(dropId: string, tierName: string, packId: string): Promise<void> {
    if (this.clients.length === 0) {
      return;
    }
    const shardIndex = this.pickShardIndexForTier(dropId, tierName);
    const redis = this.clients[shardIndex];
    const remKey = packRemainingKey(packId);
    const listKey = tierAvailableListKey(dropId, tierName);

    const script = `
      local remv = redis.call("INCR", KEYS[1])
      if remv == 1 then
        redis.call("LPUSH", KEYS[2], ARGV[2])
      end
      local ch = ARGV[1]
      if ch and ch ~= "" then
        redis.call("PUBLISH", ch, "release")
      end
    `;
    await redis.eval(script, 2, remKey, listKey, env.packTierUpdatesChannel, packId);
  }

  /**
   * Sum of per-pack `remaining` counters for every pack line in each (drop, tier), from Redis.
   * Matches the live reservation inventory used by the tier Lua.
   */
  async readTierAvailabilitySnapshots(): Promise<Array<{ dropId: string; tierId: string; availableCount: number }>> {
    if (this.clients.length === 0) {
      return [];
    }

    const out: Array<{ dropId: string; tierId: string; availableCount: number }> = [];
    const discovered = new Set<string>();

    for (const redis of this.clients) {
      const listKeys = await this.scanTierAvailableListKeys(redis);
      for (const listKey of listKeys) {
        const parsed = this.parseTierAvailableListKey(listKey);
        if (!parsed) {
          continue;
        }
        const dedupeKey = `${parsed.dropId}\0${parsed.tierName}`;
        if (discovered.has(dedupeKey)) {
          continue;
        }
        discovered.add(dedupeKey);

        const orderedPackIds = await redis.lrange(listKey, 0, -1);
        if (orderedPackIds.length === 0) {
          out.push({ dropId: parsed.dropId, tierId: parsed.tierName, availableCount: 0 });
          continue;
        }

        const remainingKeys = orderedPackIds.map((id) => packRemainingKey(id));
        const vals = await redis.mget(...remainingKeys);
        let sum = 0;
        for (const v of vals) {
          const n = Math.floor(Number(v ?? 0));
          if (Number.isFinite(n) && n >= 0) {
            sum += n;
          }
        }
        out.push({ dropId: parsed.dropId, tierId: parsed.tierName, availableCount: sum });
      }
    }

    out.sort((a, b) => {
      if (a.dropId === b.dropId) {
        return a.tierId.localeCompare(b.tierId);
      }
      return a.dropId.localeCompare(b.dropId);
    });
    return out;
  }

  private async scanTierAvailableListKeys(redis: Redis): Promise<string[]> {
    const out: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "pullvault:tier:*:available", "COUNT", 200);
      cursor = String(nextCursor);
      if (Array.isArray(keys) && keys.length > 0) {
        out.push(...keys);
      }
    } while (cursor !== "0");
    return out;
  }

  private parseTierAvailableListKey(key: string): { dropId: string; tierName: string } | null {
    const match = /^pullvault:tier:([^:]+):(.+):available$/.exec(key.trim());
    if (!match) {
      return null;
    }
    return {
      dropId: match[1].trim(),
      tierName: match[2].trim()
    };
  }

  async disconnect(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.quit()));
  }
}
