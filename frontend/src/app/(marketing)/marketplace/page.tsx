"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import {
  ApiRequestError,
  apiGetJson,
  apiPostJson,
  type MarketplaceListing,
  type MarketplacePurchaseResponse
} from "@/lib/api";
import { MARKETPLACE_BUYER_PREMIUM_RATE_PERCENT, MARKETPLACE_SELLER_PREMIUM_RATE_PERCENT } from "@/lib/premiums";
import { useAuth } from "@/context/auth-context";

function formatUsd(value: string | undefined): string {
  if (!value) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function rarityBadgeClass(rarity: string): string {
  const r = rarity.toLowerCase();
  if (r.includes("ultra") || r.includes("secret")) {
    return "bg-violet-500/90 text-white";
  }
  if (r.includes("rare") || r.includes("holo")) {
    return "bg-amber-500/90 text-slate-950";
  }
  if (r.includes("uncommon")) {
    return "bg-sky-600/90 text-white";
  }
  return "bg-slate-600/90 text-white";
}

export default function MarketplacePage() {
  const { user, token, isReady } = useAuth();
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id || !token) {
      setListings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiGetJson<MarketplaceListing[]>("/marketplace/browse");
      setListings(Array.isArray(data) ? data : []);
    } catch (e) {
      const message =
        e instanceof ApiRequestError ? e.message : "Could not load the marketplace.";
      setError(message);
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, token]);

  useEffect(() => {
    if (!flashMessage) return;
    const t = window.setTimeout(() => setFlashMessage(null), 4000);
    return () => window.clearTimeout(t);
  }, [flashMessage]);

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!isReady) return;
    void load();
  }, [isReady, load]);

  const handleBuy = async (listing: MarketplaceListing) => {
    if (!token) return;
    setBuyingId(listing.userCardId);
    setError(null);
    setFlashMessage(null);
    try {
      const purchase = await apiPostJson<MarketplacePurchaseResponse>("/marketplace/purchase", {
        userCardId: listing.userCardId
      });
      setListings((prev) => prev.filter((l) => l.userCardId !== listing.userCardId));
      setFlashMessage(
        `Purchased for ${formatUsd(purchase.pricePaidUsd)} (includes ${formatUsd(purchase.buyerPremiumUsd)} premium).`
      );
    } catch (e) {
      const message =
        e instanceof ApiRequestError ? e.message : "Purchase failed. Please try again.";
      setError(message);
    } finally {
      setBuyingId(null);
    }
  };

  if (!isReady) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 text-slate-400">
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  if (!user || !token) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="text-2xl font-bold text-white">Marketplace</h1>
        <p className="mt-2 max-w-md text-sm text-slate-400">
          Sign in to browse cards other collectors have listed for sale.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-slate-950 shadow-accent-glow transition hover:bg-accent-deep"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 md:pt-10">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Marketplace</h1>
          <p className="mt-1 text-sm text-slate-400">
            Fixed-price listings from other players. Your own listings are hidden here.
          </p>
          <div className="group relative mt-2 inline-flex items-center gap-1.5 text-xs text-slate-400">
            <button
              type="button"
              className="flex h-4 w-4 items-center justify-center rounded-full border border-white/25 text-[10px] font-bold text-slate-200 transition hover:border-amber-300 hover:text-amber-300"
            >
              i
            </button>
            <span className="cursor-help transition-colors group-hover:text-amber-300/90">
              No buyer premium · {MARKETPLACE_SELLER_PREMIUM_RATE_PERCENT}% seller fee
            </span>
            <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-64 rounded-xl border border-white/10 bg-slate-900 p-3 shadow-2xl opacity-0 transition-opacity group-hover:opacity-100">
              <p className="text-xs leading-relaxed text-slate-300">
                Buyers pay <span className="font-semibold text-amber-300">no premium</span> — you pay the listed price only. Sellers are charged a <span className="font-semibold text-amber-300">{MARKETPLACE_SELLER_PREMIUM_RATE_PERCENT}% platform fee</span> deducted from their proceeds at sale.
              </p>
              <p className="mt-1 text-xs text-slate-500">Buyer premium: {MARKETPLACE_BUYER_PREMIUM_RATE_PERCENT}%</p>
            </div>
          </div>
        </div>
        <Link
          href="/collection"
          className="shrink-0 rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
        >
          My collection
        </Link>
      </header>

      {flashMessage ? (
        <div
          className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
          role="status"
        >
          {flashMessage}
        </div>
      ) : null}

      {error ? (
        <div
          className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse overflow-hidden rounded-2xl border border-white/10 bg-surface-raised"
            >
              <div className="aspect-[4/3] bg-white/5" />
              <div className="space-y-2 p-4">
                <div className="h-4 w-3/4 rounded bg-white/10" />
                <div className="h-3 w-1/2 rounded bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      ) : listings.length === 0 ? (
        <div className="mt-16 rounded-3xl border border-white/10 bg-surface-raised/60 px-6 py-14 text-center">
          <p className="text-sm text-slate-400">No listings from other players right now.</p>
          <p className="mt-2 text-xs text-slate-500">
            List a card from your collection to appear on the global marketplace feed.
          </p>
        </div>
      ) : (
        <ul className="mt-10 grid list-none gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <li key={listing.userCardId}>
              <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface-raised shadow-lg shadow-black/20 transition hover:border-accent/40">
                <div className="relative aspect-[4/3] overflow-hidden bg-slate-900/80">
                  <span
                    className={`absolute left-3 top-3 z-10 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${rarityBadgeClass(listing.rarity)}`}
                  >
                    {listing.rarity}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={listing.imageUrl}
                    alt=""
                    className="h-full w-full object-contain p-3"
                  />
                </div>
                <div className="flex flex-1 flex-col border-t border-white/5 p-4">
                  <h2 className="line-clamp-2 text-sm font-bold text-white">{listing.name}</h2>
                  <p className="mt-1 text-xs text-slate-500">{listing.cardSet}</p>
                  <p className="mt-3 text-lg font-bold tabular-nums text-accent">
                    {formatUsd(listing.askingPriceUsd)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    No buyer premium — you pay the listed price
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    Total: {formatUsd(listing.buyerTotalPriceUsd)}
                  </p>
                  <button
                    type="button"
                    disabled={buyingId === listing.userCardId}
                    onClick={() => void handleBuy(listing)}
                    className="mt-auto w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-slate-950 shadow-accent-glow transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {buyingId === listing.userCardId ? "Buying…" : "Buy now"}
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
