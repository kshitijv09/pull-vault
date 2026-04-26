import Decimal from "decimal.js";
import {
  creditCachedWalletBalance,
  debitCachedWalletBalanceIfSufficient,
  getOrPrimeWalletBalance,
  setCachedWalletBalance,
  userWalletBalanceKey
} from "../../infra/redis/auctionWalletStore";
import { withTransaction } from "../../db/transaction";
import { AppError } from "../../shared/errors/AppError";
import {
  MARKETPLACE_BUYER_PREMIUM_MULTIPLIER,
  MARKETPLACE_SELLER_PREMIUM_RATE,
  PREMIUM_RATE_PERCENT_SCALE
} from "../../shared/constants/premiums";
import { recordCompanyEarning } from "../analytics/earningsLedger.repository";
import { MarketplaceRepository } from "./marketplace.repository";
import type { MarketplaceListingRow, MarketplacePurchaseResult } from "./marketplace.types";

export class MarketplaceService {
  constructor(private readonly repository: MarketplaceRepository) {}

  async getListings(): Promise<MarketplaceListingRow[]> {
    const listings = await this.repository.listPublicListings();
    return listings.map((listing) => this.withBuyerPremium(listing));
  }

  /** Same as public listings but omits rows owned by `viewerUserId` (for authenticated browse). */
  async getBrowseListingsForViewer(viewerUserId: string): Promise<MarketplaceListingRow[]> {
    const id = viewerUserId.trim();
    if (!id) {
      throw new AppError("User id is required.", 400);
    }
    const listings = await this.repository.listPublicListingsExcludingSeller(id);
    return listings.map((listing) => this.withBuyerPremium(listing));
  }

  async listCardForSale(
    ownerUserId: string,
    userCardId: string,
    listingPriceUsdRaw: string
  ): Promise<{ listingPriceUsd: string }> {
    if (!ownerUserId.trim() || !userCardId.trim()) {
      throw new AppError("User id and card id are required.", 400);
    }
    const listingPriceUsd = this.assertPositiveMoneyString(listingPriceUsdRaw, "Listing price");
    await withTransaction(async (client) => {
      const row = await this.repository.lockUserCardForOwner(client, userCardId, ownerUserId);
      if (!row) {
        throw new AppError("Card not found in your collection.", 404);
      }
      if (row.sellingStatus === "listed_for_sale") {
        throw new AppError("This card is already listed for sale.", 400);
      }
      if (row.sellingStatus === "listed_for_auction") {
        throw new AppError("Cannot list a card that is already listed for auction.", 400);
      }
      await this.repository.setListedForSaleWithPrice(client, userCardId, listingPriceUsd);
    });
    return { listingPriceUsd };
  }

  async goLiveForAuction(ownerUserId: string, userCardId: string): Promise<void> {
    if (!ownerUserId.trim() || !userCardId.trim()) {
      throw new AppError("User id and card id are required.", 400);
    }
    await withTransaction(async (client) => {
      const row = await this.repository.lockUserCardForOwner(client, userCardId, ownerUserId);
      if (!row) {
        throw new AppError("Card not found in your collection.", 404);
      }
      if (row.sellingStatus === "listed_for_sale") {
        throw new AppError(
          "Unlist this card from the marketplace before putting it up for auction.",
          400
        );
      }
      if (row.sellingStatus === "listed_for_auction") {
        throw new AppError("This card is already live for auction.", 400);
      }
      await this.repository.setListedForAuction(client, userCardId);
    });
  }

  async unlistCard(ownerUserId: string, userCardId: string): Promise<void> {
    if (!ownerUserId.trim() || !userCardId.trim()) {
      throw new AppError("User id and card id are required.", 400);
    }
    await withTransaction(async (client) => {
      const row = await this.repository.lockUserCardForOwner(client, userCardId, ownerUserId);
      if (!row) {
        throw new AppError("Card not found in your collection.", 404);
      }
      if (row.sellingStatus !== "listed_for_sale") {
        throw new AppError("This card is not listed for sale.", 400);
      }
      await this.repository.clearListingForSale(client, userCardId);
    });
  }

  /**
   * Atomic marketplace purchase: buyer pays `listing_price + buyer premium` from wallet `balance`,
   * seller is credited the base listing amount, listing row is removed, and buyer receives the card
   * as a direct `user_cards` ownership row (no synthetic `user_packs` row).
   */
  async purchaseCard(buyerUserId: string, userCardId: string): Promise<MarketplacePurchaseResult> {
    if (!buyerUserId.trim() || !userCardId.trim()) {
      throw new AppError("Buyer id and listing card id are required.", 400);
    }

    let debitedRedisKey: string | null = null;
    let debitedAmountUsd: string | null = null;

    try {
      const txResult = await withTransaction(async (client) => {
        const listing = await this.repository.lockListingWithPrice(client, userCardId);
        if (!listing) {
          throw new AppError("Listing not found.", 404);
        }
        if (listing.sellingStatus !== "listed_for_sale") {
          throw new AppError("This card is not for sale.", 400);
        }

        const sellerUserId = listing.sellerUserId;
        if (sellerUserId === buyerUserId) {
          throw new AppError("You cannot purchase your own listing.", 400);
        }

        const price = new Decimal(listing.listingPriceUsd);
        if (!price.isFinite() || price.lessThanOrEqualTo(0)) {
          throw new AppError("This listing has no valid price.", 400);
        }
        const priceStr = price.toDecimalPlaces(2).toFixed(2);
        // Buyer pays the listing price only (0% buyer premium).
        void MARKETPLACE_BUYER_PREMIUM_MULTIPLIER; // retained; multiplier is 1.0 (no-op)
        const buyerPremium = new Decimal(0);
        const buyerTotal = price.toDecimalPlaces(2);
        const buyerPremiumStr = buyerPremium.toFixed(2);
        const buyerTotalStr = buyerTotal.toFixed(2);
        // Seller is charged 10% of the listing price; seller receives the net amount.
        const sellerFee = price.mul(MARKETPLACE_SELLER_PREMIUM_RATE).toDecimalPlaces(2);
        const sellerNet = price.minus(sellerFee).toDecimalPlaces(2);

        const walletIds = [buyerUserId, sellerUserId].sort();
        const w0 = await this.repository.lockWalletRow(client, walletIds[0]);
        const w1 = await this.repository.lockWalletRow(client, walletIds[1]);
        if (!w0 || !w1) {
          throw new AppError("User not found.", 404);
        }

        const walletById = new Map<string, { id: string; balance: string }>([
          [w0.id, w0],
          [w1.id, w1]
        ]);
        const buyerWallet = walletById.get(buyerUserId);
        const sellerWallet = walletById.get(sellerUserId);
        if (!buyerWallet || !sellerWallet) {
          throw new AppError("User not found.", 404);
        }

        const buyerWalletKey = userWalletBalanceKey(buyerUserId);
        const primed = await getOrPrimeWalletBalance(buyerWalletKey, buyerWallet.balance);
        if (!primed) {
          throw new AppError("Redis is not configured.", 503);
        }

        const debitResult = await debitCachedWalletBalanceIfSufficient(buyerWalletKey, buyerTotalStr);
        if (!debitResult.ok) {
          if (debitResult.reason === "insufficient") {
            throw new AppError(
              `Insufficient wallet balance. Buyer total is ${buyerTotalStr} (includes ${buyerPremiumStr} premium).`,
              400
            );
          }
          throw new AppError("Wallet cache is unavailable. Retry purchase.", 503);
        }
        debitedRedisKey = buyerWalletKey;
        debitedAmountUsd = buyerTotalStr;

        const nextSeller = new Decimal(sellerWallet.balance).plus(sellerNet).toDecimalPlaces(2).toFixed(2);

        await this.repository.updateUserBalance(client, buyerUserId, debitResult.newBalanceUsd);
        await this.repository.updateUserBalance(client, sellerUserId, nextSeller);

        await this.repository.deleteUserCard(client, userCardId);

        const inserted = await this.repository.insertMarketplaceOwnedCard(client, {
          buyerUserId,
          userPackId: null,
          catalogCardId: listing.catalogCardId,
          acquisitionPriceUsd: buyerTotalStr
        });

        await recordCompanyEarning(client, {
          eventType: "marketplace_purchase",
          transactionId: listing.userCardId,
          amountGainedUsd: sellerFee.toFixed(2),
          metadata: {
            buyerUserId,
            sellerUserId,
            userCardId: listing.userCardId,
            askingPriceUsd: priceStr,
            sellerFeeUsd: sellerFee.toFixed(2),
            sellerNetUsd: sellerNet.toFixed(2),
            buyerPremiumUsd: buyerPremiumStr,
            buyerTotalPriceUsd: buyerTotalStr
          }
        });

        return {
          purchase: {
            newUserCardId: inserted.id,
            askingPriceUsd: priceStr,
            buyerPremiumRatePercent: this.getBuyerPremiumRatePercent(),
            buyerPremiumUsd: buyerPremiumStr,
            pricePaidUsd: buyerTotalStr,
            sellerUserId
          },
          sellerCache: {
            key: userWalletBalanceKey(sellerUserId),
            balanceUsd: nextSeller
          }
        };
      });
      await setCachedWalletBalance(txResult.sellerCache.key, txResult.sellerCache.balanceUsd);
      return txResult.purchase;
    } catch (error) {
      if (debitedRedisKey && debitedAmountUsd) {
        await creditCachedWalletBalance(debitedRedisKey, debitedAmountUsd);
      }
      throw error;
    }
  }

  private assertPositiveMoneyString(raw: string, label: string): string {
    const trimmed = raw.trim();
    const amount = new Decimal(trimmed);
    if (!amount.isFinite() || amount.decimalPlaces()! > 2) {
      throw new AppError(`${label} must be a valid amount with up to 2 decimal places.`, 400);
    }
    if (amount.lessThanOrEqualTo(0)) {
      throw new AppError(`${label} must be greater than zero.`, 400);
    }
    return amount.toDecimalPlaces(2).toFixed(2);
  }

  private withBuyerPremium(listing: MarketplaceListingRow): MarketplaceListingRow {
    const asking = new Decimal(listing.askingPriceUsd).toDecimalPlaces(2);
    const premiumUsd = asking.mul(MARKETPLACE_BUYER_PREMIUM_MULTIPLIER - 1).toDecimalPlaces(2);
    const totalUsd = asking.plus(premiumUsd).toDecimalPlaces(2);
    return {
      ...listing,
      buyerPremiumRatePercent: this.getBuyerPremiumRatePercent(),
      buyerPremiumUsd: premiumUsd.toFixed(2),
      buyerTotalPriceUsd: totalUsd.toFixed(2)
    };
  }

  private getBuyerPremiumRatePercent(): string {
    void PREMIUM_RATE_PERCENT_SCALE;
    return "0.00";
  }
}
