export interface TierAvailabilitySnapshot {
  dropId: string;
  tierId: string;
  availableCount: number;
}

export interface TierAvailabilitySocketPayload {
  type: "tier_availability_snapshot";
  tiers: TierAvailabilitySnapshot[];
  updatedAt: string;
}

export interface PackPurchaseSuccessSocketPayload {
  type: "pack_purchase_success";
  userId: string;
  dropId: string;
  tierId: string;
  packId: string;
  userPackId: string;
  userCardCount: number;
  purchasedAt: string;
  cards: Array<{
    cardId: string;
    name: string;
    cardSet: string;
    rarity: string;
    marketValueUsd: string;
    imageUrl: string;
  }>;
}
