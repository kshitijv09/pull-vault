/** Max length for user-supplied `client_seed` on fairness commit (Phase 1). */
export const PACK_FAIRNESS_CLIENT_SEED_MAX_LENGTH = 512;

/** Byte length for server-generated `client_seed` when the user omits one (hex-encoded in API). */
export const PACK_FAIRNESS_SERVER_CLIENT_SEED_BYTES = 32;

/** Server secret byte length (SHA-256 commitment; stored as 64 hex chars). */
export const PACK_FAIRNESS_SERVER_SECRET_BYTES = 32;

/** Drop fairness modes. New drops default to `fairness`. */
export const PACK_FAIRNESS_MODE = {
  LEGACY: "legacy",
  FAIRNESS: "fairness"
} as const;

export type PackFairnessMode = (typeof PACK_FAIRNESS_MODE)[keyof typeof PACK_FAIRNESS_MODE];

/** Default fairness algorithm version applied to Phase 2 derivations. */
export const PACK_FAIRNESS_DEFAULT_ALGORITHM_VERSION = "standard_v1";
