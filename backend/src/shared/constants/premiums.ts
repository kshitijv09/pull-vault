/**
 * Platform-configurable premium multipliers.
 * Update these constants when business rules change.
 *
 * Auction:     buyer pays 0% premium. Seller is charged 10% of winning bid at settlement.
 * Marketplace: buyer pays 0% premium. Seller is charged 10% of listing price at sale.
 */
export const AUCTION_BID_PREMIUM_MULTIPLIER = 1.0;   // buyer pays no premium on top of bid
export const AUCTION_SELLER_PREMIUM_RATE = 0.10;      // 10% deducted from seller proceeds
export const MARKETPLACE_BUYER_PREMIUM_MULTIPLIER = 1.0;  // buyer pays asking price only
export const MARKETPLACE_SELLER_PREMIUM_RATE = 0.10;  // 10% deducted from seller proceeds

export const PREMIUM_RATE_PERCENT_SCALE = 100;
