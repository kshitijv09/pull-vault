"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiRequestError,
  getAuctionListings,
  getAuctionWsUrl,
  getPublicUserProfiles,
  initAuctionBidSession,
  placeAuctionBid,
  restoreAuctionOutbidWallet,
  type AuctionListing,
  type AuctionSocketMessage
} from "@/lib/api";
import { useAuth } from "@/context/auth-context";

type RealtimeState = {
  currentBidUsd?: string;
  currentBidderId?: string | null;
  endTime?: string;
  minNextBidUsd?: string;
  viewerCount?: number;
};

type FinalizedHighlight = {
  cardName: string;
  winnerName: string;
  winningBidUsd: string;
};

function formatUsd(value: string | undefined | null): string {
  if (!value) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s";
  const sTotal = Math.floor(ms / 1000);
  const d = Math.floor(sTotal / 86400);
  const h = Math.floor((sTotal % 86400) / 3600);
  const m = Math.floor((sTotal % 3600) / 60);
  const s = sTotal % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function isLiveSlot(listing: AuctionListing | null, nowMs: number): boolean {
  if (!listing) return false;
  if (listing.slotStatus !== "active") return false;
  return Date.parse(listing.slotStartTime) <= nowMs;
}

export default function AuctionRoomPage({ params }: { params: { auctionId: string } }) {
  const auctionId = params.auctionId;
  const { token, user } = useAuth();

  const [listing, setListing] = useState<AuctionListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [realtime, setRealtime] = useState<RealtimeState>({});
  const [tickMs, setTickMs] = useState<number>(Date.now());

  const [walletBalanceUsd, setWalletBalanceUsd] = useState<string | null>(null);
  const [minBidUsd, setMinBidUsd] = useState<string | null>(null);
  const [bidInputUsd, setBidInputUsd] = useState("");
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [isBidSubmitting, setIsBidSubmitting] = useState(false);
  const [isRestoreSubmitting, setIsRestoreSubmitting] = useState(false);
  const [finalizedHighlight, setFinalizedHighlight] = useState<FinalizedHighlight | null>(null);
  const [userNamesById, setUserNamesById] = useState<Record<string, string>>(() =>
    user?.id ? { [user.id]: user.fullName } : {}
  );
  const autoInitDoneRef = useRef(false);
  const autoInitInFlightRef = useRef(false);
  const userNameFetchInFlightRef = useRef<Set<string>>(new Set());
  const latestMinBidRef = useRef<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const loadListing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await getAuctionListings();
      const found = all.find((row) => row.id === auctionId) ?? null;
      setListing(found);
      if (!found) {
        setError("Auction listing not found.");
      }
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Could not load auction listing.");
      setListing(null);
    } finally {
      setLoading(false);
    }
  }, [auctionId]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!finalizedHighlight) return;
    const t = window.setTimeout(() => setFinalizedHighlight(null), 7000);
    return () => window.clearTimeout(t);
  }, [finalizedHighlight]);

  useEffect(() => {
    void loadListing();
  }, [loadListing]);

  useEffect(() => {
    const id = window.setInterval(() => setTickMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const slotLive = isLiveSlot(listing, tickMs);

  useEffect(() => {
    const shouldConnect = Boolean(token) && Boolean(listing?.id) && slotLive;
    if (!shouldConnect) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const ws = new WebSocket(getAuctionWsUrl(token!));
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe_auction", auctionId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as AuctionSocketMessage;
        if (!msg || typeof msg !== "object" || !("type" in msg) || !("auctionListingId" in msg)) return;
        if (msg.auctionListingId !== auctionId) return;

        if (msg.type === "auction_snapshot") {
          const previousMinBid = latestMinBidRef.current;
          setRealtime({
            currentBidUsd: msg.currentBidUsd,
            currentBidderId: msg.currentBidderId,
            endTime: msg.endTime,
            minNextBidUsd: msg.minNextBidUsd,
            viewerCount: msg.viewerCount
          });
          latestMinBidRef.current = msg.minNextBidUsd;
          setBidInputUsd((prev) => {
            const trimmed = prev.trim();
            if (!trimmed || (previousMinBid && trimmed === previousMinBid)) {
              return msg.minNextBidUsd;
            }
            return prev;
          });
          if (msg.walletBalanceUsd != null) {
            setWalletBalanceUsd(msg.walletBalanceUsd);
          }
          return;
        }

        if (msg.type === "auction_bid_updated") {
          const previousMinBid = latestMinBidRef.current;
          setRealtime((prev) => ({
            ...prev,
            currentBidUsd: msg.bidUsd,
            currentBidderId: msg.bidderId,
            endTime: msg.endTime,
            minNextBidUsd: msg.minNextBidUsd
          }));
          latestMinBidRef.current = msg.minNextBidUsd;
          setBidInputUsd((prev) => {
            const trimmed = prev.trim();
            if (!trimmed || (previousMinBid && trimmed === previousMinBid)) {
              return msg.minNextBidUsd;
            }
            return prev;
          });
          const myWalletUpdate = msg.walletUpdates?.find((update) => update.userId === user?.id);
          if (myWalletUpdate) {
            setWalletBalanceUsd(myWalletUpdate.walletBalanceUsd);
          }
          setListing((prev) =>
            prev ? { ...prev, endTime: msg.endTime, status: "live" } : prev
          );
          return;
        }

        if (msg.type === "auction_viewer_count_updated") {
          setRealtime((prev) => ({ ...prev, viewerCount: msg.viewerCount }));
          return;
        }

        if (msg.type === "auction_finalized") {
          setListing((prev) =>
            prev
              ? {
                  ...prev,
                  status: msg.status,
                  highestBidUsd: msg.winningBidUsd ?? prev.highestBidUsd,
                  highestBidderId: msg.winnerUserId
                }
              : prev
          );
          if (msg.status === "sold" && msg.winnerUserId && msg.winningBidUsd) {
            const winnerNameFromMap = userNamesById[msg.winnerUserId];
            setFinalizedHighlight({
              cardName: msg.cardName ?? listing?.cardName ?? "Card",
              winnerName: msg.winnerName ?? winnerNameFromMap ?? "Winner",
              winningBidUsd: msg.winningBidUsd
            });
          }
        }
      } catch {
        // ignore malformed socket frames
      }
    };

    ws.onerror = () => {
      setError((prev) => prev ?? "Auction live feed disconnected.");
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [auctionId, listing?.cardName, listing?.id, slotLive, token, user?.id, userNamesById]);

  const currentBid = useMemo(
    () => realtime.currentBidUsd ?? listing?.highestBidUsd ?? listing?.startBidUsd ?? null,
    [listing?.highestBidUsd, listing?.startBidUsd, realtime.currentBidUsd]
  );
  const currentBidderId = realtime.currentBidderId ?? listing?.highestBidderId ?? null;
  const currentBidderName = currentBidderId ? userNamesById[currentBidderId] ?? "Bidder" : "—";
  const sellerName = listing?.sellerId ? userNamesById[listing.sellerId] ?? "Seller" : "—";
  const minNextBid = useMemo(() => realtime.minNextBidUsd ?? minBidUsd ?? null, [minBidUsd, realtime.minNextBidUsd]);
  const viewerCount = realtime.viewerCount ?? 0;
  const endTime = realtime.endTime ?? listing?.endTime ?? null;
  const canBid = Boolean(listing) && slotLive && listing?.status === "live";
  const isHighestBidder = Boolean(user?.id) && Boolean(currentBidderId) && user?.id === currentBidderId;

  const listingTimeRemainingMs = endTime ? Math.max(0, Date.parse(endTime) - tickMs) : 0;
  const slotStartRemainingMs = listing ? Math.max(0, Date.parse(listing.slotStartTime) - tickMs) : 0;

  useEffect(() => {
    if (user?.id && user.fullName) {
      setUserNamesById((prev) => (prev[user.id] ? prev : { ...prev, [user.id]: user.fullName }));
    }
  }, [user?.fullName, user?.id]);

  useEffect(() => {
    const idsNeeded = [listing?.sellerId, currentBidderId]
      .map((id) => id?.trim() ?? "")
      .filter((id) => id.length > 0 && !userNamesById[id]);
    if (idsNeeded.length === 0) return;

    const requestKey = idsNeeded.sort().join(",");
    if (userNameFetchInFlightRef.current.has(requestKey)) return;
    userNameFetchInFlightRef.current.add(requestKey);
    void (async () => {
      try {
        const profiles = await getPublicUserProfiles(idsNeeded);
        if (!Array.isArray(profiles) || profiles.length === 0) return;
        setUserNamesById((prev) => {
          const next = { ...prev };
          for (const profile of profiles) {
            if (profile?.id && profile?.fullName) {
              next[profile.id] = profile.fullName;
            }
          }
          return next;
        });
      } catch {
        // Keep UI resilient when profile lookup fails.
      } finally {
        userNameFetchInFlightRef.current.delete(requestKey);
      }
    })();
  }, [currentBidderId, listing?.sellerId, userNamesById]);

  const initBidSession = useCallback(async (): Promise<void> => {
    if (!listing) return;
    setIsSessionLoading(true);
    setError(null);
    try {
      const data = await initAuctionBidSession(listing.id!);
      setWalletBalanceUsd(data.walletBalanceUsd);
      setMinBidUsd(data.minBidUsd);
      setBidInputUsd(data.minBidUsd);
      latestMinBidRef.current = data.minBidUsd;
      setRealtime((prev) => ({
        ...prev,
        endTime: data.endTime,
        minNextBidUsd: data.minBidUsd
      }));
    } finally {
      setIsSessionLoading(false);
    }
  }, [listing]);

  useEffect(() => {
    if (!listing?.id) {
      autoInitDoneRef.current = false;
      autoInitInFlightRef.current = false;
      return;
    }
    if (!token || !canBid || autoInitDoneRef.current || autoInitInFlightRef.current) {
      return;
    }
    autoInitInFlightRef.current = true;
    void (async () => {
      try {
        await initBidSession();
        autoInitDoneRef.current = true;
      } catch (e) {
        setError(e instanceof ApiRequestError ? e.message : "Could not initialize bidding session.");
      } finally {
        autoInitInFlightRef.current = false;
      }
    })();
  }, [canBid, initBidSession, listing?.id, token]);

  const handlePlaceBid = async () => {
    if (!listing) return;
    setIsBidSubmitting(true);
    setError(null);
    setFlash(null);
    try {
      const placed = await placeAuctionBid(listing.id!, { biddingPriceUsd: bidInputUsd.trim() });
      setBidInputUsd(placed.minNextBidUsd);
      setMinBidUsd(placed.minNextBidUsd);
      latestMinBidRef.current = placed.minNextBidUsd;
      setWalletBalanceUsd(placed.walletBalanceUsd);
      setRealtime((prev) => ({
        ...prev,
        currentBidUsd: placed.bidUsd,
        currentBidderId: placed.bidderId,
        endTime: placed.endTime,
        minNextBidUsd: placed.minNextBidUsd
      }));
      setListing((prev) =>
        prev ? { ...prev, endTime: placed.endTime, status: "live" } : prev
      );
      setFlash(placed.antiSnipingApplied ? "Bid accepted and anti-sniping extension applied." : "Bid accepted.");
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Could not place bid.");
    } finally {
      setIsBidSubmitting(false);
    }
  };

  const handleManualRestore = async () => {
    if (!listing || !currentBid) return;
    setIsRestoreSubmitting(true);
    setError(null);
    try {
      const data = await restoreAuctionOutbidWallet(listing.id!, currentBid);
      setWalletBalanceUsd(data.walletBalanceUsd);
      setFlash("Outbid restore request processed.");
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Could not restore wallet.");
    } finally {
      setIsRestoreSubmitting(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-slate-400">Loading auction room...</div>;
  }

  if (!listing || !listing.id) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-red-300">{error ?? "Auction listing not found."}</p>
        <Link href="/auctions" className="mt-4 inline-flex rounded-lg border border-white/20 px-3 py-2 text-sm text-slate-200">
          Back to auctions
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      {finalizedHighlight ? (
        <div className="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center px-4">
          <div className="w-full max-w-xl rounded-2xl border border-amber-300/50 bg-gradient-to-r from-amber-500/20 via-emerald-400/10 to-sky-400/20 px-5 py-4 shadow-2xl backdrop-blur">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-200">Auction Won</p>
            <p className="mt-1 text-lg font-semibold text-white">{finalizedHighlight.cardName}</p>
            <p className="text-sm text-slate-200">
              <span className="font-semibold text-emerald-200">{finalizedHighlight.winnerName}</span> won at{" "}
              <span className="font-semibold text-amber-200">{formatUsd(finalizedHighlight.winningBidUsd)}</span>
            </p>
          </div>
        </div>
      ) : null}

      <div className="mb-5 flex items-center justify-between gap-3">
        <Link
          href={`/auctions?view=cards&slotId=${encodeURIComponent(listing.slotId)}`}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-slate-300"
        >
          Move to cards
        </Link>
        <p className="text-xs text-slate-400">Auction room</p>
      </div>

      {flash ? <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{flash}</div> : null}
      {error ? <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr,1.1fr]">
        <section className="rounded-2xl border border-white/10 bg-surface-raised p-5">
          <div className="relative mx-auto aspect-[4/3] max-w-md rounded-xl border border-white/10 bg-slate-950/80">
            {listing.cardImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={listing.cardImageUrl} alt="" className="h-full w-full object-contain p-4" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">No card art</div>
            )}
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white">{listing.cardName ?? "Card"}</h1>
          <p className="text-sm text-slate-400">{listing.cardSet ?? "—"}</p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Current bid</p>
              <p className="mt-1 text-3xl font-extrabold text-accent">{formatUsd(currentBid)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Live viewers</p>
              <p className="mt-1 text-3xl font-extrabold text-white">{slotLive ? viewerCount : 0}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Min bid</p>
              <p className="mt-1 text-2xl font-bold text-white">{slotLive ? formatUsd(minNextBid) : "—"}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">{slotLive ? "Time left" : "Starts in"}</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {slotLive ? formatCountdown(listingTimeRemainingMs) : formatCountdown(slotStartRemainingMs)}
              </p>
            </div>
          </div>
        </section>

        <aside className="rounded-2xl border border-white/10 bg-surface-raised p-5">
          {!token ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              Sign in to join live bidding.
              <div className="mt-3">
                <Link href="/login" className="text-accent hover:underline">
                  Go to login
                </Link>
              </div>
            </div>
          ) : (
            <>
              {!canBid ? (
                <p className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                  {slotLive
                    ? "This listing is not live for bidding yet."
                    : `Bidding opens when this slot starts (${formatDateTime(listing.slotStartTime)}).`}
                </p>
              ) : null}

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-white">Your bid wallet</p>
                </div>
                <p className="text-sm text-slate-300">Balance: {formatUsd(walletBalanceUsd)}</p>

                <input
                  value={bidInputUsd}
                  onChange={(e) => setBidInputUsd(e.target.value)}
                  placeholder={minNextBid ?? "Bid USD"}
                  className="mt-4 w-full rounded-xl border border-white/15 bg-slate-950 px-4 py-3 text-lg text-white"
                  disabled={!canBid || isSessionLoading || isBidSubmitting || isRestoreSubmitting}
                />
                {isSessionLoading ? (
                  <p className="mt-3 text-xs text-slate-400">Loading bid session...</p>
                ) : null}

                <button
                  type="button"
                  onClick={() => void handlePlaceBid()}
                  disabled={
                    isSessionLoading ||
                    isBidSubmitting ||
                    isRestoreSubmitting ||
                    !bidInputUsd.trim() ||
                    !canBid ||
                    isHighestBidder
                  }
                  className="mt-4 w-full rounded-xl bg-accent px-6 py-4 text-xl font-extrabold text-slate-950 disabled:opacity-50"
                >
                  {isBidSubmitting ? "Placing bid..." : "PLACE BID"}
                </button>
                <div className="group relative mt-3 inline-flex items-center gap-2 text-xs text-slate-400">
                  <button
                    type="button"
                    className="flex h-4 w-4 items-center justify-center rounded-full border border-white/25 text-[10px] font-bold text-slate-200 transition group-hover:border-amber-300 group-hover:text-amber-300"
                  >
                    i
                  </button>
                  <span className="cursor-help transition-colors group-hover:text-amber-300/90">
                    No buyer premium · 10% seller fee
                  </span>
                  <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-3 w-64 rounded-xl border border-white/10 bg-slate-900 p-3 shadow-2xl opacity-0 transition-opacity group-hover:opacity-100">
                    <p className="text-xs leading-relaxed text-slate-300">
                      No buyer premium — you pay the winning bid only. The <span className="font-semibold text-amber-300">seller pays a 10% platform fee</span> on their proceeds at settlement.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void handleManualRestore()}
                  disabled={isSessionLoading || isBidSubmitting || isRestoreSubmitting || !currentBid || !canBid}
                  className="mt-3 w-full rounded-xl border border-white/20 px-4 py-2 text-sm text-slate-300 disabled:opacity-40"
                >
                  {isRestoreSubmitting ? "Restoring wallet..." : "Manual outbid restore"}
                </button>

                <div className="mt-4 grid gap-2 rounded-lg border border-white/10 bg-slate-950/40 p-3 text-xs text-slate-300">
                  <p className="text-slate-400">Ends at {formatDateTime(endTime ?? undefined)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-400">Seller</span>
                    <span className="font-medium text-white">{sellerName}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-400">Highest bidder</span>
                    <span className="font-medium text-white">{currentBidderName}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

