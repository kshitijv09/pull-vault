"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import {
  ApiRequestError,
  addAuctionSlotListing,
  apiGetJson,
  getAuctionListings,
  getAuctionSlots,
  type AuctionListing,
  type AuctionSlotStatus,
  type AuctionSlot,
  type UserOwnedCard
} from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { AUCTION_SELLER_PREMIUM_RATE_PERCENT } from "@/lib/premiums";


function isCardListing(l: AuctionListing): l is AuctionListing & { id: string } {
  return Boolean(l.id);
}

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

function rarityBadgeClass(rarity: string): string {
  const r = rarity.toLowerCase();
  if (r.includes("ultra") || r.includes("secret")) return "bg-violet-500/90 text-white";
  if (r.includes("rare") || r.includes("holo")) return "bg-amber-500/90 text-slate-950";
  if (r.includes("uncommon")) return "bg-sky-600/90 text-white";
  return "bg-slate-600/90 text-white";
}

function listingPhaseClass(status: AuctionListing["status"]): string {
  if (!status) return "bg-slate-600/30 text-slate-400 border-slate-500/40";
  if (status === "live") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
  if (status === "pending") return "bg-amber-500/20 text-amber-200 border-amber-500/30";
  if (status === "sold") return "bg-sky-500/20 text-sky-200 border-sky-500/30";
  return "bg-slate-600/30 text-slate-300 border-slate-500/40";
}

function slotStatusClass(status: AuctionSlotStatus): string {
  if (status === "active") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
  if (status === "scheduled") return "bg-amber-500/20 text-amber-200 border-amber-500/30";
  if (status === "completed") return "bg-slate-600/30 text-slate-300 border-slate-500/40";
  return "bg-red-500/15 text-red-200 border-red-500/30";
}

/** Slots that have not opened for live bidding yet — sellers may add listings here. */
function isUpcomingAuctionSlot(status: AuctionSlotStatus, slotStartTime: string): boolean {
  if (status === "scheduled") return true;
  if (status === "active") {
    return Date.parse(slotStartTime) > Date.now();
  }
  return false;
}

/**
 * Live bidding window: slot is `active` and its `start_time` has passed.
 * (Scheduled / completed / cancelled slots are never in this phase here.)
 */
function isSlotLiveBiddingPhase(slot: AuctionSlot | null, nowMs: number): boolean {
  if (!slot) return false;
  if (slot.status !== "active") return false;
  return Date.parse(slot.startTime) <= nowMs;
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

export default function AuctionsPage() {
  const { token, isReady, user } = useAuth();
  const [slots, setSlots] = useState<AuctionSlot[]>([]);
  const [listings, setListings] = useState<AuctionListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [view, setView] = useState<"auctions" | "cards">("auctions");
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [slotStatusFilter, setSlotStatusFilter] = useState<"all" | AuctionSlotStatus>("all");

  const [addModalSlotId, setAddModalSlotId] = useState<string | null>(null);
  const [addModalStep, setAddModalStep] = useState<"pick" | "confirm">("pick");
  const [eligibleCards, setEligibleCards] = useState<UserOwnedCard[]>([]);
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const [eligibleError, setEligibleError] = useState<string | null>(null);
  const [pickCard, setPickCard] = useState<UserOwnedCard | null>(null);
  const [addStartBidUsd, setAddStartBidUsd] = useState("");
  const [addModalError, setAddModalError] = useState<string | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [tickMs, setTickMs] = useState<number>(Date.now());

  const loadSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAuctionSlots({
        slotStatus: slotStatusFilter === "all" ? undefined : slotStatusFilter
      });
      setSlots(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Could not load auction slots.");
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [slotStatusFilter]);

  const loadListingsForSlot = useCallback(async (slotId: string) => {
    try {
      const data = await getAuctionListings({ slotId });
      setListings(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to load listings for slot", e);
      setListings([]);
    }
  }, []);

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
    if (!isReady) return;
    void loadSlots();
  }, [isReady, loadSlots]);

  useEffect(() => {
    if (selectedSlotId) {
      void loadListingsForSlot(selectedSlotId);
    } else {
      setListings([]);
    }
  }, [selectedSlotId, loadListingsForSlot]);

  useEffect(() => {
    const id = window.setInterval(() => setTickMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user?.id || !token) {
      return;
    }
    let cancelled = false;
    setEligibleLoading(true);
    setEligibleError(null);
    void (async () => {
      try {
        const data = await apiGetJson<UserOwnedCard[]>(`/users/${user.id}/cards`, { collectionListing: "unlisted" });
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setEligibleCards(list);
      } catch (e) {
        if (!cancelled) {
          setEligibleError(e instanceof ApiRequestError ? e.message : "Could not load your cards.");
          setEligibleCards([]);
        }
      } finally {
        if (!cancelled) setEligibleLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user?.id]);

  const closeAddCardModal = useCallback(() => {
    setAddModalSlotId(null);
    setAddModalStep("pick");
    setPickCard(null);
    setAddStartBidUsd("");
    setAddModalError(null);
    setAddSubmitting(false);
  }, []);

  const openAddCardModal = useCallback((slotId: string) => {
    setAddModalSlotId(slotId);
    setAddModalStep("pick");
    setPickCard(null);
    setAddStartBidUsd("");
    setAddModalError(null);
  }, []);

  const handleConfirmAddToAuction = useCallback(async () => {
    if (!addModalSlotId || !pickCard) return;
    setAddSubmitting(true);
    setAddModalError(null);
    try {
      await addAuctionSlotListing(addModalSlotId, {
        userCardId: pickCard.userCardId,
        startBidUsd: addStartBidUsd.trim()
      });
      setFlash("Card added to this auction.");
      setEligibleCards((prev) => prev.filter((c) => c.userCardId !== pickCard.userCardId));
      closeAddCardModal();
      void loadSlots();
      if (selectedSlotId === addModalSlotId) void loadListingsForSlot(addModalSlotId);
    } catch (e) {
      setAddModalError(e instanceof ApiRequestError ? e.message : "Could not add card to auction.");
    } finally {
      setAddSubmitting(false);
    }
  }, [addModalSlotId, addStartBidUsd, closeAddCardModal, loadSlots, loadListingsForSlot, selectedSlotId, pickCard]);

  const selectedSlot = useMemo(
    () => slots.find((s) => s.id === selectedSlotId) ?? null,
    [slots, selectedSlotId]
  );
  const selectedSlotListings = useMemo(() => {
    if (!selectedSlotId) return [];
    const cards = listings.filter(isCardListing);
    return [...cards].sort((a, b) => {
      const aTime = Date.parse(a.endTime ?? "");
      const bTime = Date.parse(b.endTime ?? "");
      return aTime - bTime;
    });
  }, [selectedSlotId, listings]);

  const slotAllowsLiveBidding = selectedSlot != null && isSlotLiveBiddingPhase(selectedSlot, tickMs);

  const handleParticipate = (slotId: string) => {
    setSelectedSlotId(slotId);
    setView("cards");
    setError(null);
    setFlash(null);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 md:pt-10">
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Auctions</h1>
        </div>
      </header>

      {flash ? <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{flash}</div> : null}
      {error ? <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}

      {view === "auctions" ? (
        <section className="rounded-2xl border border-white/10 bg-surface-raised p-4">
          <div className="mb-4 flex flex-wrap gap-2">
            <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-slate-400">
              <span className="font-medium uppercase tracking-wide text-slate-500">Auction slot status</span>
              <select
                value={slotStatusFilter}
                onChange={(e) => setSlotStatusFilter(e.target.value as "all" | AuctionSlotStatus)}
                className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="all">All</option>
                <option value="scheduled">Scheduled</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          </div>
          {loading ? (
            <p className="text-sm text-slate-400">Loading auctions...</p>
          ) : slots.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">No auctions are available right now.</div>
          ) : (
            <ul className="space-y-3">
              {slots.map((slot) => {
                const totalCount = slot.currentCapacity;
                const slotLive = isSlotLiveBiddingPhase(slot, tickMs);
                const isOngoing = slotLive;
                return (
                  <li key={slot.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        {slot.name ? (
                          <p className="text-sm font-semibold text-white">{slot.name}</p>
                        ) : null}
                        <p className={`text-sm font-semibold ${slot.name ? 'text-slate-400 mt-1' : 'text-white'}`}>Auction {slot.id.slice(0, 8).toUpperCase()}</p>
                        <p className="mt-1 text-xs text-slate-400">Starts: {formatDateTime(slot.startTime)}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          Cards: {totalCount} / {slot.capacity}
                          {totalCount === 0 ? " · No cards listed in this slot yet" : null}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${slotStatusClass(slot.status)}`}>
                            slot: {slot.status}
                          </span>
                          <span className={`rounded-md border px-2 py-0.5 text-[10px] uppercase ${listingPhaseClass(isOngoing ? "live" : "pending")}`}>
                            {isOngoing ? "bidding open" : "not live"}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                        {isUpcomingAuctionSlot(slot.status, slot.startTime) ? (
                          user && token ? (
                            <button
                              type="button"
                              onClick={() => openAddCardModal(slot.id)}
                              className="rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                            >
                              Add card to auction
                            </button>
                          ) : (
                            <p className="max-w-[160px] text-right text-[11px] text-slate-500">Sign in to add a card to this upcoming auction.</p>
                          )
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleParticipate(slot.id)}
                          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-slate-950"
                        >
                          View cards
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <section className="rounded-2xl border border-white/10 bg-surface-raised p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setView("auctions");
              }}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-slate-300"
            >
              Back to auctions
            </button>
            <p className="text-xs text-slate-400">Grid view · pick a card to open its room</p>
          </div>



          {selectedSlotListings.length === 0 ? (
            <p className="text-sm text-slate-400">No cards listed in this slot yet.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {selectedSlotListings.map((listing) => {
                const liveBid = listing.highestBidUsd ?? listing.startBidUsd ?? undefined;
                const startBid = listing.startBidUsd ?? undefined;
                return (
                  <li key={listing.id}>
                    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-white/5 transition hover:border-accent/30">
                      <div className="flex flex-1 flex-col text-left">
                        <div className="relative aspect-[4/3] bg-slate-950/80">
                          {listing.cardImageUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={listing.cardImageUrl} alt="" className="h-full w-full object-contain p-3" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">No art</div>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col gap-2 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${rarityBadgeClass(listing.cardRarity ?? "")}`}>
                              {listing.cardRarity ?? "—"}
                            </span>
                            <span className={`rounded-md border px-2 py-0.5 text-[10px] uppercase ${listingPhaseClass(listing.status)}`}>
                              {listing.status ?? "—"}
                            </span>
                          </div>
                          <p className="font-semibold leading-snug text-white">{listing.cardName ?? "Card"}</p>
                          <p className="text-xs text-slate-400">{listing.cardSet ?? "—"}</p>
                          {slotAllowsLiveBidding ? (
                            <div className="mt-auto space-y-1 border-t border-white/10 pt-2 text-xs text-slate-400">
                              <p className="text-sm font-semibold text-accent">Current {formatUsd(liveBid)}</p>
                              <p>Ends {formatDateTime(listing.endTime ?? undefined)}</p>
                            </div>
                          ) : (
                            <div className="mt-auto space-y-1 border-t border-white/10 pt-2 text-xs text-slate-400">
                              <p className="text-sm font-semibold text-white">Starting bid {formatUsd(startBid)}</p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="border-t border-white/10 p-3 pt-0">
                        <Link
                          href={`/auctions/${listing.id}`}
                          className={`w-full rounded-lg px-3 py-2 text-center text-sm font-semibold ${
                            slotAllowsLiveBidding
                              ? "bg-accent text-slate-950"
                              : "border border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"
                          }`}
                        >
                          {slotAllowsLiveBidding ? (token ? "Join bid" : "Join bid (sign in)") : "View card"}
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {addModalSlotId ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-auction-card-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAddCardModal();
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="add-auction-card-title" className="text-lg font-semibold text-white">
              {addModalStep === "pick" ? "Choose a card" : "Confirm listing"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">Slot {addModalSlotId.slice(0, 8)}…</p>

            {addModalStep === "pick" ? (
              <>
                {eligibleLoading ? (
                  <p className="mt-6 text-sm text-slate-400">Loading your cards…</p>
                ) : eligibleError ? (
                  <p className="mt-6 text-sm text-red-300">{eligibleError}</p>
                ) : eligibleCards.length === 0 ? (
                  <p className="mt-6 text-sm text-slate-400">
                    No eligible cards (only unlisted cards can be added to auction).
                  </p>
                ) : (
                  <ul className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                    {eligibleCards.map((card) => (
                      <li key={card.userCardId}>
                        <button
                          type="button"
                          onClick={() => {
                            setPickCard(card);
                            const hint = Number(card.marketValueUsd);
                            setAddStartBidUsd(Number.isFinite(hint) && hint > 0 ? hint.toFixed(2) : "");
                            setAddModalError(null);
                            setAddModalStep("confirm");
                          }}
                          className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left transition hover:border-accent/40"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={card.imageUrl} alt="" className="h-16 w-12 shrink-0 rounded object-contain" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-white">{card.name}</p>
                            <p className="truncate text-xs text-slate-400">{card.cardSet}</p>
                          </div>
                          <span className="text-xs text-slate-500">Select</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                {pickCard ? (
                  <div className="mt-4 flex gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pickCard.imageUrl} alt="" className="h-20 w-14 shrink-0 rounded object-contain" />
                    <div className="min-w-0">
                      <p className="font-semibold text-white">{pickCard.name}</p>
                      <p className="text-xs text-slate-400">{pickCard.cardSet}</p>
                    </div>
                  </div>
                ) : null}
                <label className="mt-4 block">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Starting bid (USD)</span>
                  <input
                    value={addStartBidUsd}
                    onChange={(e) => setAddStartBidUsd(e.target.value)}
                    inputMode="decimal"
                    className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                    placeholder="e.g. 24.99"
                  />
                </label>
                {addModalError ? <p className="mt-3 text-sm text-red-300">{addModalError}</p> : null}
                <div className="group relative mt-4 inline-flex items-center gap-2 text-xs text-slate-400">
                  <button
                    type="button"
                    className="flex h-4 w-4 items-center justify-center rounded-full border border-white/25 text-[10px] font-bold text-slate-200 transition group-hover:border-amber-300 group-hover:text-amber-300"
                  >
                    i
                  </button>
                  <span className="cursor-help transition-colors group-hover:text-amber-300/90">
                    Seller fee applies
                  </span>
                  <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-3 w-64 rounded-xl border border-white/10 bg-slate-900 p-3 shadow-2xl opacity-0 transition-opacity group-hover:opacity-100">
                    <p className="text-xs leading-relaxed text-slate-300">
                      A <span className="font-semibold text-amber-300">{AUCTION_SELLER_PREMIUM_RATE_PERCENT}% platform fee</span> is deducted from your proceeds when your card sells. Buyers pay no additional premium.
                    </p>
                  </div>
                </div>
              </>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeAddCardModal}
                disabled={addSubmitting}
                className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              {addModalStep === "confirm" ? (
                <button
                  type="button"
                  disabled={addSubmitting || !addStartBidUsd.trim() || !pickCard}
                  onClick={() => void handleConfirmAddToAuction()}
                  className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
                >
                  {addSubmitting ? "Adding…" : "Confirm add to auction"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
