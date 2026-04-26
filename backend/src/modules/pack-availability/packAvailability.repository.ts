import { query } from "../../db";
import type { TierAvailabilitySnapshot } from "./packAvailability.types";

interface TierAvailabilityRow {
  drop_id: string;
  tier_name: string;
  available_count: string;
}

export class PackAvailabilityRepository {
  async listTierAvailabilitySnapshot(): Promise<TierAvailabilitySnapshot[]> {
    const result = await query<TierAvailabilityRow>(
      `
        SELECT
          pi.drop_id,
          p.tier_name,
          COUNT(*)::text AS available_count
        FROM pack_inventory pi
        INNER JOIN packs p ON p.id = pi.pack_id
        WHERE pi.drop_id IS NOT NULL
          AND pi.status = 'available'
        GROUP BY pi.drop_id, p.tier_name
        ORDER BY pi.drop_id, p.tier_name
      `
    );

    return result.rows.map((row) => ({
      dropId: row.drop_id,
      tierId: row.tier_name,
      availableCount: Number(row.available_count)
    }));
  }
}
