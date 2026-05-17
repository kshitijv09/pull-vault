import { AppError } from "../../shared/errors/AppError";
import { PACK_FAIRNESS_MODE } from "../../shared/constants/packFairnessCommit.constants";
import type {
  CatalogCardRow,
  FulfillmentInputs,
  FulfillmentResult,
  PackFulfillmentStrategy
} from "./PackFulfillmentStrategy";

/**
 * Legacy path: cards are pinned at the pack template level via `pack_card`.
 * Reads the template's catalog cards and hands them back to the consumer
 * exactly as before — no fairness commit lookup, no derivation.
 */
export class LegacyPackCardFulfillment implements PackFulfillmentStrategy {
  public readonly name = PACK_FAIRNESS_MODE.LEGACY;

  async fulfill(inputs: FulfillmentInputs): Promise<FulfillmentResult> {
    const { client, pack } = inputs;
    const result = await client.query<CatalogCardRow>(
      `
        SELECT
          c.id,
          c.card_id,
          c.name,
          c.card_set,
          c.rarity,
          c.market_value_usd::text AS market_value_usd,
          c.image_url
        FROM pack_card pc
        INNER JOIN card c ON c.id = pc.card_id
        WHERE pc.pack_id = $1::uuid
        ORDER BY c.id
      `,
      [pack.packTypeId]
    );

    if (result.rows.length !== pack.cardsPerPack) {
      throw new AppError(
        `Pack template ${pack.packTypeId} declares cards_per_pack=${pack.cardsPerPack} but has ${result.rows.length} pack_card rows.`,
        500
      );
    }

    return { cards: result.rows };
  }
}
