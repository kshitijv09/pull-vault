/** Sliding window length for drop purchase rate limiting (60s rolling window). */
export const DROP_PURCHASE_RATE_LIMIT_WINDOW_MS = 60_000;

/** Max authenticated POST `/drops/packs/:dropId/purchase` calls per user per minute (global). */
export const DROP_PURCHASE_MAX_REQUESTS_PER_USER_PER_MINUTE = 60;

/** Max purchase requests per user per drop per minute (within the same sliding window). */
export const DROP_PURCHASE_MAX_REQUESTS_PER_USER_PER_DROP_PER_MINUTE = 20;

/** Max POST `/drops/packs/:dropId/purchase` calls per IP per minute (global). */
export const DROP_PURCHASE_MAX_REQUESTS_PER_IP_PER_MINUTE = 120;

/** Max purchase requests per IP per drop per minute (within the same sliding window). */
export const DROP_PURCHASE_MAX_REQUESTS_PER_IP_PER_DROP_PER_MINUTE = 40;
