/** JSON body for queued pack purchase API. */
export interface QueuePackPurchaseBody {
  dropId: string;
  /**
   * Tier discriminator: `packs.tier_name` for this drop. Multiple pack rows can share it;
   * Redis assigns sequentially across those rows.
   */
  tierId: string;
}

export interface PackPurchaseQueuePayload extends QueuePackPurchaseBody {
  /** Populated from `x-user-id` header until auth middleware owns the user context. */
  userId: string;
  requestedAt: string;
  /** Catalog pack row chosen by Redis sequential Lua for this request. */
  packId: string;
}

export interface QueuePackPurchaseAccepted {
  status: "queued";
  message: string;
}
