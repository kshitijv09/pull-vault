/** H1: seller↔buyer sold auctions in rolling window */
export const AUCTION_FRAUD_REPEAT_PAIR_WINDOW_DAYS = 30;
export const AUCTION_FRAUD_REPEAT_PAIR_MIN_CLOSED_TRADES = 3;

/** H2: sold auction with one distinct open-phase bidder vs catalog market */
export const AUCTION_FRAUD_UNCONTESTED_LOW_PRICE_RATIO_MAX = 0.3;

/**
 * H3: sold listing only — some bidder who is **not** the winner (and not the seller) has ≥ this many
 * rows in `auction_bid_history` on **this** listing (heavy bidding then losing vs one-off bids).
 */
export const AUCTION_FRAUD_H3_MIN_OPEN_BIDS_NON_WINNER = 6;

/** H6: same bidder rapid open bids in `auction_bid_history` — fire when a rolling window contains **more than** this many bids */
export const AUCTION_FRAUD_BID_SPAM_WINDOW_SECONDS = 60;
export const AUCTION_FRAUD_BID_SPAM_COUNT_THRESHOLD = 5;
