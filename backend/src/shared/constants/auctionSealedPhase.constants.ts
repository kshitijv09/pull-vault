/**
 * After this many anti-sniping timer extensions, the listing enters sealed-bid phase
 * (open ascending bids rejected; use sealed endpoint).
 */
export const AUCTION_ANTI_SNIPING_EXTENSIONS_BEFORE_SEALED = 2;

/** When sealed phase starts, ensure at least this much time remains (may extend end_ms). */
export const AUCTION_SEALED_PHASE_MIN_DURATION_MS = 60_000;
