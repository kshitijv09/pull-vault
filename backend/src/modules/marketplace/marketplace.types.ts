export interface MarketplaceListingRow {
  userCardId: string;
  sellerUserId: string;
  catalogCardId: string;
  packId: string | null;
  cardId: string;
  name: string;
  cardSet: string;
  imageUrl: string;
  rarity: string;
  askingPriceUsd: string;
  buyerPremiumRatePercent: string;
  buyerPremiumUsd: string;
  buyerTotalPriceUsd: string;
  listedAt: string;
}

export interface MarketplacePurchaseResult {
  newUserCardId: string;
  askingPriceUsd: string;
  buyerPremiumRatePercent: string;
  buyerPremiumUsd: string;
  pricePaidUsd: string;
  sellerUserId: string;
}
