import type { PoolClient } from "pg";
import { query } from "../../db";
import type {
  AuctionBidHistoryEntry,
  AuctionListingsFilter,
  AuctionListingRow,
  AuctionListingStatus,
  AuctionSlotStatus
} from "./auction.types";

type SlotRecord = {
  id: string;
  status: AuctionSlotStatus;
  start_time: Date;
  capacity: number;
  current_capacity: number;
  name: string | null;
  /** Auction listing timer length in minutes. */
  duration: number;
};

export class AuctionRepository {
  async listSlots(filter?: { slotStatus?: AuctionSlotStatus }) {
    const whereParts: string[] = [];
    const params: unknown[] = [];
    if (filter?.slotStatus) {
      params.push(filter.slotStatus);
      whereParts.push(`status = $${params.length}`);
    }
    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    const res = await query(`
      SELECT id, status, start_time, capacity, current_capacity, duration, name
      FROM auction_slots
      ${whereSql}
      ORDER BY 
        CASE WHEN status = 'active' THEN 0 ELSE 1 END ASC,
        start_time ASC
    `, params);
    
    return res.rows.map(r => ({
      id: r.id,
      status: r.status,
      startTime: r.start_time.toISOString(),
      capacity: r.capacity,
      currentCapacity: r.current_capacity,
      duration: r.duration,
      name: r.name
    }));
  }

  async listAuctions(filter?: AuctionListingsFilter): Promise<AuctionListingRow[]> {
    const whereParts: string[] = [];
    const params: unknown[] = [];

    if (filter?.slotId) {
      params.push(filter.slotId);
      whereParts.push(`s.id = $${params.length}::uuid`);
    }
    if (filter?.slotStatus) {
      params.push(filter.slotStatus);
      whereParts.push(`s.status = $${params.length}`);
    }
    if (filter?.listingStatus) {
      params.push(filter.listingStatus);
      whereParts.push(`al.id IS NOT NULL AND al.status = $${params.length}`);
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const res = await query<{
      id: string | null;
      slot_id: string;
      card_id: string | null;
      seller_id: string | null;
      start_bid: string | null;
      reserve_price: string | null;
      current_high_bid: string | null;
      current_high_bidder_id: string | null;
      end_time: Date | null;
      status: AuctionListingStatus | null;
      slot_status: AuctionSlotStatus;
      slot_start_time: Date;
      card_name: string | null;
      card_set: string | null;
      card_rarity: string | null;
      card_image_url: string | null;
    }>(
      `
        SELECT
          al.id,
          s.id AS slot_id,
          al.card_id,
          al.seller_id,
          al.start_bid::text AS start_bid,
          al.reserve_price::text AS reserve_price,
          al.current_high_bid::text AS current_high_bid,
          al.current_high_bidder_id,
          al.end_time,
          al.status,
          s.status AS slot_status,
          s.start_time AS slot_start_time,
          c.name AS card_name,
          c.card_set AS card_set,
          c.rarity AS card_rarity,
          c.image_url AS card_image_url
        FROM auction_slots s
        LEFT JOIN auction_listings al ON al.slot_id = s.id
        LEFT JOIN user_cards uc ON uc.id = al.card_id
        LEFT JOIN card c ON c.id = uc.card_id
        ${whereSql}
        ORDER BY
          CASE WHEN s.status = 'active' THEN 0 ELSE 1 END ASC,
          s.start_time ASC,
          al.end_time ASC NULLS LAST,
          al.created_at ASC NULLS LAST
      `,
      params
    );

    return res.rows.map((r) => ({
      id: r.id,
      slotId: r.slot_id,
      cardId: r.card_id,
      sellerId: r.seller_id,
      startBidUsd: r.start_bid,
      reservePriceUsd: r.reserve_price,
      highestBidUsd: r.current_high_bid,
      highestBidderId: r.current_high_bidder_id,
      endTime: r.end_time ? r.end_time.toISOString() : null,
      status: r.status,
      slotStatus: r.slot_status,
      slotStartTime: r.slot_start_time.toISOString(),
      cardName: r.card_name,
      cardSet: r.card_set,
      cardRarity: r.card_rarity,
      cardImageUrl: r.card_image_url
    }));
  }

  async lockUserCardForOwner(
    client: PoolClient,
    userCardId: string,
    ownerUserId: string
  ): Promise<{
    userCardId: string;
    ownerUserId: string;
    sellingStatus: string;
    marketValueUsd: string;
  } | null> {
    const res = await client.query<{
      user_card_id: string;
      owner_user_id: string;
      selling_status: string;
      market_value_usd: string;
    }>(
      `
        SELECT
          uc.id AS user_card_id,
          uc.user_id AS owner_user_id,
          uc.selling_status,
          c.market_value_usd::text AS market_value_usd
        FROM user_cards uc
        INNER JOIN card c ON c.id = uc.card_id
        WHERE uc.id = $1::uuid
          AND uc.user_id = $2::uuid
        FOR UPDATE OF uc
      `,
      [userCardId, ownerUserId]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const r = res.rows[0];
    return {
      userCardId: r.user_card_id,
      ownerUserId: r.owner_user_id,
      sellingStatus: r.selling_status,
      marketValueUsd: r.market_value_usd
    };
  }

  async findSlotWithRemainingCapacity(client: PoolClient): Promise<SlotRecord | null> {
    const res = await client.query<{
      id: string;
      status: AuctionSlotStatus;
      start_time: Date;
      capacity: number;
      duration: number;
      current_capacity: number;
      name: string | null;
    }>(
      `
        SELECT s.id, s.status, s.start_time, s.capacity, s.duration, s.current_capacity, s.name
        FROM auction_slots s
        WHERE s.status IN ('scheduled', 'active')
          AND s.current_capacity < s.capacity
        ORDER BY s.start_time ASC
        LIMIT 1
        FOR UPDATE OF s
      `
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      start_time: row.start_time,
      capacity: row.capacity,
      duration: row.duration,
      current_capacity: row.current_capacity,
      name: row.name ? row.name : ""
    };
  }

  /** Lock a slot row */
  async lockSlotByIdForListingInsert(
    client: PoolClient,
    slotId: string
  ): Promise<SlotRecord | null> {
    const res = await client.query<{
      id: string;
      status: AuctionSlotStatus;
      start_time: Date;
      capacity: number;
      duration: number;
      current_capacity: number;
      name: string | null;
    }>(
      `
        SELECT
          s.id,
          s.status,
          s.start_time,
          s.capacity,
          s.duration,
          s.current_capacity,
          s.name
        FROM auction_slots s
        WHERE s.id = $1::uuid
        FOR UPDATE OF s
      `,
      [slotId]
    );
    const row = res.rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      status: row.status,
      start_time: row.start_time,
      capacity: row.capacity,
      duration: row.duration,
      current_capacity: row.current_capacity,
      name: row.name
    };
  }

  async createDefaultActiveSlot(client: PoolClient, capacity: number, durationMinutes: number): Promise<SlotRecord> {
    const res = await client.query<{
      id: string;
      status: AuctionSlotStatus;
      start_time: Date;
      capacity: number;
      duration: number;
      current_capacity: number;
      name: string | null;
    }>(
      `
        INSERT INTO auction_slots (start_time, status, capacity, duration, current_capacity, name)
        VALUES (NOW(), 'active', $1, $2, 0, NULL)
        RETURNING id, status, start_time, capacity, duration, current_capacity, name
      `,
      [capacity, durationMinutes]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      status: row.status,
      start_time: row.start_time,
      capacity: row.capacity,
      duration: row.duration,
      current_capacity: row.current_capacity,
      name: row.name
    };
  }

  async insertSlot(client: PoolClient, startTimeIso: string, capacity: number, durationMinutes: number, name?: string): Promise<SlotRecord> {
    const res = await client.query<{
      id: string;
      status: AuctionSlotStatus;
      start_time: Date;
      capacity: number;
      duration: number;
      current_capacity: number;
      name: string | null;
    }>(
      `
        INSERT INTO auction_slots (start_time, status, capacity, duration, current_capacity, name)
        VALUES ($1::timestamptz, 'scheduled', $2, $3, 0, $4)
        RETURNING id, status, start_time, capacity, duration, current_capacity, name
      `,
      [startTimeIso, capacity, durationMinutes, name || null]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      status: row.status,
      start_time: row.start_time,
      capacity: row.capacity,
      duration: row.duration,
      current_capacity: row.current_capacity,
      name: row.name
    };
  }

  async createAuctionListing(
    client: PoolClient,
    input: {
      slotId: string;
      userCardId: string;
      sellerId: string;
      startBidUsd: string;
      reservePriceUsd: string | null;
      endTimeIso: string;
      status: AuctionListingStatus;
    }
  ): Promise<{ id: string }> {
    const res = await client.query<{ id: string }>(
      `
        INSERT INTO auction_listings (
          slot_id,
          card_id,
          seller_id,
          start_bid,
          reserve_price,
          current_high_bid,
          current_high_bidder_id,
          end_time,
          status
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::numeric,
          $5::numeric,
          NULL,
          NULL,
          $6::timestamptz,
          $7
        )
        RETURNING id
      `,
      [
        input.slotId,
        input.userCardId,
        input.sellerId,
        input.startBidUsd,
        input.reservePriceUsd,
        input.endTimeIso,
        input.status
      ]
    );
    return { id: res.rows[0].id };
  }

  async incrementSlotCurrentCapacity(client: PoolClient, slotId: string): Promise<void> {
    await client.query(
      `
        UPDATE auction_slots
        SET current_capacity = current_capacity + 1
        WHERE id = $1::uuid
      `,
      [slotId]
    );
  }

  async setUserCardSellingStatus(
    client: PoolClient,
    userCardId: string,
    status: "unlisted" | "listed_for_auction"
  ): Promise<void> {
    await client.query(`UPDATE user_cards SET selling_status = $1 WHERE id = $2::uuid`, [status, userCardId]);
  }

  async lockAuctionSlotForStart(
    client: PoolClient,
    slotId: string
  ): Promise<{
    id: string;
    status: AuctionSlotStatus;
    startTime: string;
    duration: number;
  } | null> {
    const res = await client.query<{
      id: string;
      status: AuctionSlotStatus;
      start_time: Date;
      duration: number;
    }>(
      `
        SELECT
          s.id,
          s.status,
          s.start_time,
          s.duration
        FROM auction_slots s
        WHERE s.id = $1::uuid
        FOR UPDATE OF s
      `,
      [slotId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    const row = res.rows[0];
    return {
      id: row.id,
      status: row.status,
      startTime: row.start_time.toISOString(),
      duration: row.duration
    };
  }

  async activateSlotAndLiveListingsForStart(
    client: PoolClient,
    slotId: string,
    endTimeIso: string
  ): Promise<string[]> {
    await client.query(
      `
        UPDATE auction_slots
        SET status = 'active'
        WHERE id = $1::uuid
      `,
      [slotId]
    );

    const listings = await client.query<{ id: string }>(
      `
        UPDATE auction_listings
        SET
          status = 'live',
          end_time = $2::timestamptz
        WHERE slot_id = $1::uuid
          AND status IN ('pending', 'live')
        RETURNING id
      `,
      [slotId, endTimeIso]
    );
    return listings.rows.map((r) => r.id);
  }

  async setAuctionListingStatus(
    client: PoolClient,
    auctionListingId: string,
    status: AuctionListingStatus
  ): Promise<void> {
    await client.query(`UPDATE auction_listings SET status = $1 WHERE id = $2::uuid`, [status, auctionListingId]);
  }

  async getAuctionListingById(auctionListingId: string): Promise<{
    id: string;
    sellerId: string;
    startBidUsd: string;
    highestBidUsd: string | null;
    highestBidderId: string | null;
    endTime: string;
    status: AuctionListingStatus;
  } | null> {
    const res = await query<{
      id: string;
      seller_id: string;
      start_bid: string;
      current_high_bid: string | null;
      current_high_bidder_id: string | null;
      end_time: Date;
      status: AuctionListingStatus;
    }>(
      `
        SELECT
          auction_listings.id,
          auction_listings.seller_id,
          auction_listings.start_bid::text AS start_bid,
          auction_listings.current_high_bid::text AS current_high_bid,
          auction_listings.current_high_bidder_id,
          auction_listings.end_time,
          auction_listings.status
        FROM auction_listings
        WHERE id = $1::uuid
      `,
      [auctionListingId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    const row = res.rows[0];
    return {
      id: row.id,
      sellerId: row.seller_id,
      startBidUsd: row.start_bid,
      highestBidUsd: row.current_high_bid,
      highestBidderId: row.current_high_bidder_id,
      endTime: row.end_time.toISOString(),
      status: row.status
    };
  }

  async listLiveListingsPastEndTime(limit = 100): Promise<string[]> {
    const res = await query<{ id: string }>(
      `
        SELECT id
        FROM auction_listings
        WHERE status = 'live'
          AND end_time <= NOW()
        ORDER BY end_time ASC
        LIMIT $1::int
      `,
      [limit]
    );
    return res.rows.map((r) => r.id);
  }

  async findSlotsReadyToStart(atIso: string): Promise<string[]> {
    const res = await query<{ id: string }>(
      `
        SELECT id
        FROM auction_slots
        WHERE status = 'scheduled'
          AND start_time <= $1::timestamptz
        ORDER BY start_time ASC
      `,
      [atIso]
    );
    return res.rows.map((r) => r.id);
  }

  async getUserBalance(userId: string): Promise<string | null> {
    const res = await query<{ balance: string }>(
      `
        SELECT balance::text AS balance
        FROM app_users
        WHERE id = $1::uuid
      `,
      [userId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return res.rows[0].balance;
  }

  async getMinIncrementForCurrentPrice(currentPriceUsd: string): Promise<string | null> {
    const res = await query<{ min_increment: string }>(
      `
        SELECT min_increment::text AS min_increment
        FROM auction_bid_increment_rules
        WHERE $1::numeric >= min_price
          AND (max_price IS NULL OR $1::numeric <= max_price)
        ORDER BY min_price DESC
        LIMIT 1
      `,
      [currentPriceUsd]
    );
    return res.rows[0]?.min_increment ?? null;
  }

  async getAuctionFinalizedDetails(
    auctionListingId: string,
    winnerUserId: string | null
  ): Promise<{ cardName: string | null; winnerName: string | null } | null> {
    const res = await query<{ card_name: string | null; winner_name: string | null }>(
      `
        SELECT
          c.name AS card_name,
          winner.full_name AS winner_name
        FROM auction_listings al
        LEFT JOIN user_cards uc ON uc.id = al.card_id
        LEFT JOIN card c ON c.id = uc.card_id
        LEFT JOIN app_users winner ON winner.id = $2::uuid
        WHERE al.id = $1::uuid
        LIMIT 1
      `,
      [auctionListingId, winnerUserId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return {
      cardName: res.rows[0].card_name,
      winnerName: res.rows[0].winner_name
    };
  }

  async updateListingAfterBid(
    client: PoolClient,
    input: {
      auctionListingId: string;
      endTimeIso: string;
    }
  ): Promise<void> {
    await client.query(
      `
        UPDATE auction_listings
        SET
          end_time = $1::timestamptz
        WHERE id = $2::uuid
      `,
      [input.endTimeIso, input.auctionListingId]
    );
  }

  async insertBidHistory(
    client: PoolClient,
    input: { auctionListingId: string; bidderId: string; bidAmountUsd: string }
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO auction_bid_history (auction_listing_id, bidder_id, bid_amount)
        VALUES ($1::uuid, $2::uuid, $3::numeric)
      `,
      [input.auctionListingId, input.bidderId, input.bidAmountUsd]
    );
  }

  async listBidHistory(auctionListingId: string, limit = 20): Promise<AuctionBidHistoryEntry[]> {
    const res = await query<{
      id: string;
      auction_listing_id: string;
      bidder_id: string;
      bid_amount: string;
      bid_at: Date;
    }>(
      `
        SELECT
          id,
          auction_listing_id,
          bidder_id,
          bid_amount::text AS bid_amount,
          bid_at
        FROM auction_bid_history
        WHERE auction_listing_id = $1::uuid
        ORDER BY bid_at DESC
        LIMIT $2
      `,
      [auctionListingId, limit]
    );
    return res.rows.map((row) => ({
      id: row.id,
      auctionListingId: row.auction_listing_id,
      bidderId: row.bidder_id,
      bidAmountUsd: row.bid_amount,
      bidAt: row.bid_at.toISOString()
    }));
  }

  async lockListingForExpiry(
    client: PoolClient,
    auctionListingId: string
  ): Promise<{
    id: string;
    slotId: string;
    sellerId: string;
    cardId: string;
    reservePriceUsd: string | null;
    highestBidUsd: string | null;
    highestBidderId: string | null;
    status: AuctionListingStatus;
    endTime: string;
  } | null> {
    const res = await client.query<{
      id: string;
      slot_id: string;
      seller_id: string;
      card_id: string;
      reserve_price: string | null;
      current_high_bid: string | null;
      current_high_bidder_id: string | null;
      status: AuctionListingStatus;
      end_time: Date;
    }>(
      `
        SELECT
          id,
          slot_id,
          seller_id,
          card_id,
          reserve_price::text AS reserve_price,
          current_high_bid::text AS current_high_bid,
          current_high_bidder_id,
          status,
          end_time
        FROM auction_listings
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [auctionListingId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    const row = res.rows[0];
    return {
      id: row.id,
      slotId: row.slot_id,
      sellerId: row.seller_id,
      cardId: row.card_id,
      reservePriceUsd: row.reserve_price,
      highestBidUsd: row.current_high_bid,
      highestBidderId: row.current_high_bidder_id,
      status: row.status,
      endTime: row.end_time.toISOString()
    };
  }

  async updateListingCompletion(
    client: PoolClient,
    input: {
      auctionListingId: string;
      status: AuctionListingStatus;
      highestBidUsd: string | null;
      highestBidderId: string | null;
      endTimeIso: string;
    }
  ): Promise<void> {
    await client.query(
      `
        UPDATE auction_listings
        SET
          status = $1,
          current_high_bid = $2::numeric,
          current_high_bidder_id = $3::uuid,
          end_time = $4::timestamptz
        WHERE id = $5::uuid
      `,
      [
        input.status,
        input.highestBidUsd,
        input.highestBidderId,
        input.endTimeIso,
        input.auctionListingId
      ]
    );
  }

  async setUserBalance(client: PoolClient, userId: string, nextBalance: string): Promise<void> {
    await client.query(`UPDATE app_users SET balance = $1::numeric WHERE id = $2::uuid`, [
      nextBalance,
      userId
    ]);
  }

  async creditUserBalance(client: PoolClient, userId: string, amountUsd: string): Promise<void> {
    await client.query(
      `UPDATE app_users SET balance = (balance + $1::numeric) WHERE id = $2::uuid`,
      [amountUsd, userId]
    );
  }

  async lockAuctionedUserCardForTransfer(
    client: PoolClient,
    sellerId: string,
    userCardId: string
  ): Promise<{ userCardId: string } | null> {
    const res = await client.query<{ user_card_id: string }>(
      `
        SELECT uc.id AS user_card_id
        FROM user_cards uc
        WHERE uc.user_id = $1::uuid
          AND uc.id = $2::uuid
          AND uc.selling_status = 'listed_for_auction'
        FOR UPDATE OF uc
      `,
      [sellerId, userCardId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return { userCardId: res.rows[0].user_card_id };
  }

  async transferUserCardToWinner(
    client: PoolClient,
    input: {
      userCardId: string;
      winnerUserId: string;
      winningBidUsd: string;
    }
  ): Promise<void> {
    await client.query(
      `
        UPDATE user_cards
        SET
          user_id = $1::uuid,
          user_pack_id = NULL,
          acquisition_price = $2::numeric,
          selling_status = 'unlisted'
        WHERE id = $3::uuid
      `,
      [input.winnerUserId, input.winningBidUsd, input.userCardId]
    );
  }

  async clearSellerAuctionStatusForCard(
    client: PoolClient,
    sellerId: string,
    userCardId: string
  ): Promise<void> {
    await client.query(
      `
        UPDATE user_cards
        SET selling_status = 'unlisted'
        WHERE user_id = $1::uuid
          AND id = $2::uuid
          AND selling_status = 'listed_for_auction'
      `,
      [sellerId, userCardId]
    );
  }

  async completeSlotIfNoLiveListings(client: PoolClient, slotId: string): Promise<void> {
    const remainingRes = await client.query<{ c: string }>(
      `
        SELECT COUNT(*)::text AS c
        FROM auction_listings
        WHERE slot_id = $1::uuid
          AND status IN ('pending', 'live')
      `,
      [slotId]
    );
    const remaining = Number(remainingRes.rows[0]?.c ?? "0");
    if (remaining === 0) {
      await client.query(`UPDATE auction_slots SET status = 'completed' WHERE id = $1::uuid`, [slotId]);
    }
  }
}
