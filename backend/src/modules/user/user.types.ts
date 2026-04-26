export interface CreateUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
  phone?: string;
  city?: string;
  country?: string;
  initialBalance?: string;
}

export interface DepositFundsInput {
  userId: string;
  amount: string;
}

export interface AuthPayload {
  token: string;
  user: UserProfile;
}

/** `user_cards.selling_status` — default `unlisted`. */
export type UserCardSellingStatus = "unlisted" | "listed_for_sale" | "listed_for_auction";

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  city: string | null;
  country: string | null;
  currencyCode: string;
  balance: string;
  /** Funds usable only for auctions (separate from `balance`). */
  auctionBalance: string;
  createdAt: string;
}

/** Public-safe user identity payload for cross-user display surfaces. */
export interface PublicUserProfile {
  id: string;
  fullName: string;
}

/** `GET /users/:userId/cards?collectionListing=` — default `unlisted`. */
export type UserCardsListingScope = "unlisted" | "listed_for_sale" | "listed_for_auction";

/** Optional filters for `GET /users/:userId/cards` (AND semantics). */
export interface UserCardsFilter {
  rarity?: string;
  cardSet?: string;
  /** Case-insensitive substring match on catalog card name. */
  name?: string;
  /** Which rows to include by `selling_status` (normalized in service). */
  collectionListing?: UserCardsListingScope | string;
}

/** Distinct rarity and set values present in the user’s owned cards. */
export interface UserOwnedCardFacets {
  rarities: string[];
  cardSets: string[];
}
