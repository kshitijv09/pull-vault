import type Decimal from "decimal.js";
import type { PoolClient } from "pg";
import type { PackFairnessMode } from "../../shared/constants/packFairnessCommit.constants";

/**
 * Row shape returned by every fulfillment strategy. Matches the catalog `card`
 * projection the queue consumer already knows how to price (via TCG lookup) and
 * insert into `user_cards`.
 */
export interface CatalogCardRow {
  id: string;
  card_id: string;
  name: string;
  card_set: string;
  rarity: string;
  market_value_usd: string;
  image_url: string | null;
}

export interface PackContext {
  inventoryId: string;
  packTypeId: string;
  packPriceUsd: Decimal;
  cardsPerPack: number;
  fairnessMode: PackFairnessMode;
  fairnessAlgorithmVersion: string;
}

export interface FulfillmentInputs {
  /** Transactional client; strategies MUST issue their queries on this client. */
  client: PoolClient;
  userId: string;
  dropId: string;
  pack: PackContext;
  /** `user_packs.id` already inserted inside the same transaction. */
  userPackId: string;
  /** Phase 1 fairness session id; required when the drop is in `fairness` mode. */
  nonce?: string;
}

export interface FulfillmentResult {
  cards: CatalogCardRow[];
}

/**
 * Pluggable per-pack outcome producer used inside the queue consumer
 * transaction. Two implementations ship today: `LegacyPackCardFulfillment`
 * (preserves the historical `pack_card` template path) and
 * `FairnessPackFulfillment` (Phase 2 of the provably-fair pack openings spec).
 *
 * The strategy is selected per drop via `drops.fairness_mode`; new drops
 * default to `fairness`.
 */
export interface PackFulfillmentStrategy {
  readonly name: PackFairnessMode;
  fulfill(inputs: FulfillmentInputs): Promise<FulfillmentResult>;
}
