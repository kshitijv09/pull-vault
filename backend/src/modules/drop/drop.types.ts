export interface Drop {
  id: string;
  name: string;
  startTime: string;
  durationMinutes: number;
  status: "upcoming" | "live" | "ended";
  createdAt: string;
  updatedAt: string;
}

export interface Pack {
  id: string;
  tierName: string;
  priceUsd: string;
  cardsPerPack: number;
  availableCount: number;
  dropStartsAt: string;
  rarityWeights: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export type PackDropPhase = "upcoming" | "live" | "sold_out";

export interface AvailablePackForUser extends Pack {
  dropPhase: PackDropPhase;
  userCanAfford: boolean;
}

export interface DropWithPacks extends Drop {
  packs: Pack[];
}

export interface PackDropSummary {
  id: string;
  tier: string;
  startsAt: string;
  availableCount: number;
  packPriceUsd: string;
}

export interface PackDropPurchaseRequest {
  userId: string;
  dropId: string;
  quantity: number;
}

export interface PackDropPurchaseResult {
  purchaseId: string;
  status: "accepted" | "rejected";
}

export interface NextDropState {
  id: string;
  name: string;
  startTime: string;
  status: string;
  isLive: boolean;
  countdownMs: number;
}

export interface CreateDropTierInput {
  tierName: string;
  rarityWeights: Record<string, number>;
  packCount: number;
}

export interface CreateDropInput {
  name: string;
  startTime: string;
  durationMinutes?: number;
  tiers: CreateDropTierInput[];
  status?: "upcoming" | "live" | "ended";
}
