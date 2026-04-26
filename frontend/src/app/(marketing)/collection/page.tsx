"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LayoutGrid, List, MoreVertical, Search, X } from "lucide-react";
import {
  ApiRequestError,
  apiGetJson,
  apiPostJson,

  getCollectionWsUrl,
  unlistUserCard,
  type UserOwnedCard,
  type UserOwnedCardFacets
} from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { MARKETPLACE_SELLER_PREMIUM_RATE_PERCENT } from "@/lib/premiums";
import { PortfolioPerformancePanel } from "@/components/collection/PortfolioPerformancePanel";

function formatRelativeObtained(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = Date.now() - t;
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function formatUsd(value: string | undefined): string {
  if (!value) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatPnl(market: string | undefined, acquisition: string | undefined): string {
  if (!market || !acquisition) return "—";
  const m = Number(market);
  const a = Number(acquisition);
  if (!Number.isFinite(m) || !Number.isFinite(a)) return "—";
  const diff = m - a;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    signDisplay: "always"
  }).format(diff);
  return formatted;
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

function sellingStatusLabel(raw: string | undefined): string {
  const s = raw?.trim();
  if (s === "listed_for_sale") return "Listed for sale";
  if (s === "listed_for_auction") return "Listed for auction";
  return "Unlisted";
}

type CollectionListingScope = "unlisted" | "listed_for_sale" | "listed_for_auction";

function CollectionCardActionMenu({
  card,
  userId,
  isOpen,
  onToggle,
  onClose,
  onCardUpdated,
  onRequestListForSale
}: {
  card: UserOwnedCard;
  userId: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onCardUpdated: () => void;
  onRequestListForSale: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setLocalError(null);
      return;
    }
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const node = wrapRef.current;
      const target = e.target as Node | null;
      if (node && target && !node.contains(target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen, onClose]);

  const canListForSale = card.sellingStatus === "unlisted";
  const canUnlist = card.sellingStatus === "listed_for_sale";

  const handleUnlist = async () => {
    setLocalError(null);
    setPending(true);
    try {
      await unlistUserCard(userId, card.userCardId);
      onClose();
      onCardUpdated();
    } catch (e) {
      setLocalError(e instanceof ApiRequestError ? e.message : "Could not unlist this card.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        aria-label="Card actions"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        className="rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {isOpen ? (
        <div
          className="absolute right-0 top-full z-30 mt-1 min-w-[220px] rounded-xl border border-white/10 bg-slate-900 py-1 shadow-xl shadow-black/40"
          role="menu"
        >
          {localError ? (
            <p className="border-b border-white/10 px-3 py-2 text-xs text-red-300">{localError}</p>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={!canListForSale || pending}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              onRequestListForSale();
            }}
            className="flex w-full px-3 py-2.5 text-left text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            List for sale…
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canUnlist || pending}
            onClick={(e) => {
              e.stopPropagation();
              void handleUnlist();
            }}
            className="flex w-full border-t border-white/5 px-3 py-2.5 text-left text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending && canUnlist ? "Updating…" : "Unlist from sale"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const NAME_SEARCH_DEBOUNCE_MS = 350;

export default function CollectionPage() {
  const { user, token, isReady, setAuth } = useAuth();
  const [cards, setCards] = useState<UserOwnedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [livePricesByExternalCardId, setLivePricesByExternalCardId] = useState<Record<string, string>>({});
  const [facets, setFacets] = useState<UserOwnedCardFacets>({ rarities: [], cardSets: [] });
  const [facetsError, setFacetsError] = useState<string | null>(null);
  const [rarityFilter, setRarityFilter] = useState("");
  const [cardSetFilter, setCardSetFilter] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [debouncedName, setDebouncedName] = useState("");
  const [listingScope, setListingScope] = useState<CollectionListingScope>("unlisted");
  const [menuOpenUserCardId, setMenuOpenUserCardId] = useState<string | null>(null);
  const [listModalCard, setListModalCard] = useState<UserOwnedCard | null>(null);
  const [listPriceInput, setListPriceInput] = useState("");
  const [listModalError, setListModalError] = useState<string | null>(null);
  const [listModalSubmitting, setListModalSubmitting] = useState(false);

  const [collectionTotal, setCollectionTotal] = useState<number | null>(null);
  const initialLoadDone = useRef(false);
  /** External `cardId`s whose live market price just changed over the socket (brief UI emphasis). */
  const [hotMarketCardIds, setHotMarketCardIds] = useState<Set<string>>(() => new Set());

  const subscriptionKey = useMemo(
    () =>
      Array.from(new Set(cards.map((c) => c.cardId)))
        .sort()
        .join("\0"),
    [cards]
  );

  useEffect(() => {
    if (!token || subscriptionKey.length === 0) {
      return;
    }

    const ids = subscriptionKey.split("\0");
    const ws = new WebSocket(getCollectionWsUrl(token));
    const highlightTimeouts: Record<string, number> = {};

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe_cards", cardIds: ids }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type?: string;
          prices?: Record<string, string>;
          cardId?: string;
          priceUsd?: string;
        };
        if (
          msg.type === "card_prices_snapshot" &&
          msg.prices != null &&
          typeof msg.prices === "object" &&
          !Array.isArray(msg.prices)
        ) {
          setLivePricesByExternalCardId((prev) => ({
            ...prev,
            ...(msg.prices as Record<string, string>)
          }));
        }
        if (msg.type === "card_price_updated" && msg.cardId && msg.priceUsd !== undefined) {
          const externalId = String(msg.cardId);
          const price = String(msg.priceUsd);
          setLivePricesByExternalCardId((prev) => ({ ...prev, [externalId]: price }));

          const prevT = highlightTimeouts[externalId];
          if (prevT) window.clearTimeout(prevT);
          setHotMarketCardIds((prevSet) => {
            const next = new Set(prevSet);
            next.add(externalId);
            return next;
          });
          highlightTimeouts[externalId] = window.setTimeout(() => {
            setHotMarketCardIds((prevSet) => {
              const next = new Set(prevSet);
              next.delete(externalId);
              return next;
            });
            delete highlightTimeouts[externalId];
          }, 1400);
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      ws.close();
      for (const t of Object.values(highlightTimeouts)) {
        window.clearTimeout(t);
      }
    };
  }, [token, subscriptionKey]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedName(nameInput.trim());
    }, NAME_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [nameInput]);

  const loadFacets = useCallback(async () => {
    if (!user?.id || !token) {
      setFacets({ rarities: [], cardSets: [] });
      return;
    }
    setFacetsError(null);
    try {
      const data = await apiGetJson<UserOwnedCardFacets>(`/users/${user.id}/cards/facets`);
      setFacets(
        data && typeof data === "object"
          ? {
              rarities: Array.isArray(data.rarities) ? data.rarities : [],
              cardSets: Array.isArray(data.cardSets) ? data.cardSets : []
            }
          : { rarities: [], cardSets: [] }
      );
    } catch (e) {
      const message =
        e instanceof ApiRequestError ? e.message : "Could not load filter options.";
      setFacetsError(message);
    }
  }, [user?.id, token]);

  const load = useCallback(async () => {
    if (!user?.id || !token) {
      setCards([]);
      setLoading(false);
      initialLoadDone.current = false;
      return;
    }
    const showFullSkeleton = !initialLoadDone.current;
    if (showFullSkeleton) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await apiGetJson<UserOwnedCard[]>(`/users/${user.id}/cards`, {
        rarity: rarityFilter || undefined,
        cardSet: cardSetFilter || undefined,
        name: debouncedName || undefined,
        collectionListing: listingScope
      });
      const list = Array.isArray(data) ? data : [];
      setCards(list);
      setMenuOpenUserCardId(null);
      if (!rarityFilter && !cardSetFilter && !debouncedName && listingScope === "unlisted") {
        setCollectionTotal(list.length);
      }
    } catch (e) {
      const message =
        e instanceof ApiRequestError ? e.message : "Could not load your collection.";
      setError(message);
      setCards([]);
    } finally {
      initialLoadDone.current = true;
      setLoading(false);
    }
  }, [user?.id, token, rarityFilter, cardSetFilter, debouncedName, listingScope]);

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!facetsError) return;
    const t = window.setTimeout(() => setFacetsError(null), 4000);
    return () => window.clearTimeout(t);
  }, [facetsError]);

  useEffect(() => {
    if (!isReady) return;
    void loadFacets();
  }, [isReady, loadFacets]);

  useEffect(() => {
    if (!isReady) return;
    void load();
  }, [isReady, load]);

  const attributeFiltersActive = Boolean(rarityFilter || cardSetFilter || debouncedName);
  const listingFilterActive = listingScope !== "unlisted";
  const hasActiveFilters = attributeFiltersActive || listingFilterActive;

  const countLabel = useMemo(() => {
    if (loading && !initialLoadDone.current) return "Loading…";
    const n = cards.length;
    if (collectionTotal != null && attributeFiltersActive && listingScope === "unlisted") {
      if (n === 0) return `No matches (${collectionTotal} in your collection)`;
      return n === 1 ? `Showing 1 of ${collectionTotal} cards` : `Showing ${n} of ${collectionTotal} cards`;
    }
    if (listingScope === "listed_for_sale") {
      return n === 1 ? "1 card listed for sale" : `${n} cards listed for sale`;
    }
    if (listingScope === "listed_for_auction") {
      return n === 1 ? "1 card listed for auction" : `${n} cards listed for auction`;
    }
    return n === 1 ? "You have 1 card" : `You have ${n} cards`;
  }, [cards.length, collectionTotal, attributeFiltersActive, listingScope, loading]);

  const clearFilters = useCallback(() => {
    setRarityFilter("");
    setCardSetFilter("");
    setNameInput("");
    setDebouncedName("");
    setListingScope("unlisted");
  }, []);

  const submitListForSale = useCallback(async () => {
    if (!user?.id || !token || !listModalCard) return;
    setListModalError(null);
    setListModalSubmitting(true);
    try {
      await apiPostJson(`/users/${user.id}/cards/${listModalCard.userCardId}/list-for-sale`, {
        listingPriceUsd: listPriceInput.trim()
      });
      setListModalCard(null);
      setListPriceInput("");
      void load();
    } catch (e) {
      setListModalError(e instanceof ApiRequestError ? e.message : "Could not list this card.");
    } finally {
      setListModalSubmitting(false);
    }
  }, [user?.id, token, listModalCard, listPriceInput, load]);



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
        <h1 className="text-2xl font-bold text-white">Collection</h1>
        <p className="mt-2 max-w-md text-sm text-slate-400">
          Sign in to see the cards you own, pulled from packs.
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
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Collection</h1>
          <p className="mt-1 text-sm text-slate-400">{countLabel}</p>
          <p className="mt-1 text-xs text-slate-500">
            Wallet balance:{" "}
            <span className="font-medium text-slate-300 tabular-nums">{formatUsd(user.balance)}</span>
          </p>

        </div>
        <div className="flex flex-wrap items-center gap-2">

          <div className="flex rounded-2xl border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              aria-label="Grid view"
              onClick={() => setView("grid")}
              className={`rounded-xl p-2 transition ${
                view === "grid"
                  ? "bg-white/15 text-accent shadow-accent-glow"
                  : "text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <LayoutGrid className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="List view"
              onClick={() => setView("list")}
              className={`rounded-xl p-2 transition ${
                view === "list"
                  ? "bg-white/15 text-accent shadow-accent-glow"
                  : "text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <List className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <PortfolioPerformancePanel userId={user.id} />

      <div className="mt-10 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block min-w-[160px] flex-1 sm:max-w-[220px]">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Listing</span>
          <select
            value={listingScope}
            onChange={(e) => setListingScope(e.target.value as CollectionListingScope)}
            className="w-full cursor-pointer rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/30"
          >
            <option value="unlisted">Unlisted</option>
            <option value="listed_for_sale">Listed for sale</option>
            <option value="listed_for_auction">Listed for auction</option>
          </select>
        </label>
        <label className="block min-w-[140px] flex-1 sm:max-w-[200px]">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Rarity</span>
          <select
            value={rarityFilter}
            onChange={(e) => setRarityFilter(e.target.value)}
            className="w-full cursor-pointer rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white outline-none ring-accent/0 transition focus:border-accent/50 focus:ring-2 focus:ring-accent/30"
          >
            <option value="">All rarities</option>
            {facets.rarities.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-[140px] flex-1 sm:max-w-[220px]">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Set</span>
          <select
            value={cardSetFilter}
            onChange={(e) => setCardSetFilter(e.target.value)}
            className="w-full cursor-pointer rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/30"
          >
            <option value="">All sets</option>
            {facets.cardSets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 flex-[2] sm:min-w-[200px]">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Search by name…"
              autoComplete="off"
              className="w-full rounded-xl border border-white/10 bg-slate-950/80 py-2.5 pl-10 pr-10 text-sm text-white placeholder:text-slate-600 outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/30"
            />
            {nameInput ? (
              <button
                type="button"
                onClick={() => {
                  setNameInput("");
                  setDebouncedName("");
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 hover:bg-white/10 hover:text-slate-300"
                aria-label="Clear name search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </label>
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="shrink-0 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            Clear filters
          </button>
        ) : null}
      </div>
      {facetsError ? (
        <p className="mt-2 text-xs text-amber-200/90" role="status">
          {facetsError}
        </p>
      ) : null}

      {error ? (
        <div
          className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {loading && !initialLoadDone.current ? (
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      ) : cards.length === 0 && !hasActiveFilters ? (
        listingScope === "unlisted" ? (
          <div className="mt-16 rounded-3xl border border-white/10 bg-surface-raised/60 px-6 py-14 text-center">
            <p className="text-sm text-slate-400">
              No cards yet. Open a pack from a live drop to build your collection.
            </p>
            <Link
              href="/drop-sale"
              className="mt-6 inline-flex rounded-2xl border border-accent/40 bg-accent/10 px-5 py-2.5 text-sm font-semibold text-accent hover:bg-accent/15"
            >
              Go to drop sale
            </Link>
          </div>
        ) : listingScope === "listed_for_sale" ? (
          <div className="mt-16 rounded-3xl border border-white/10 bg-surface-raised/60 px-6 py-14 text-center">
            <p className="text-sm text-slate-400">You do not have any cards listed for sale.</p>
            <p className="mt-2 text-xs text-slate-500">
              Use the marketplace flow to list a card, or switch listing filter to &quot;Unlisted&quot;.
            </p>
          </div>
        ) : (
          <div className="mt-16 rounded-3xl border border-white/10 bg-surface-raised/60 px-6 py-14 text-center">
            <p className="text-sm text-slate-400">You do not have any cards listed for auction.</p>
          </div>
        )
      ) : cards.length === 0 && hasActiveFilters ? (
        <div className="mt-16 rounded-3xl border border-white/10 bg-surface-raised/60 px-6 py-14 text-center">
          <p className="text-sm text-slate-400">No cards match these filters.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-6 inline-flex rounded-2xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10"
          >
            Clear filters
          </button>
        </div>
      ) : view === "grid" ? (
        <ul className="mt-10 grid list-none gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <li key={card.userCardId}>
              <article
                className="group overflow-hidden rounded-2xl border border-white/10 bg-surface-raised shadow-lg shadow-black/20 transition hover:border-accent/45 hover:shadow-accent-ring"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-slate-900/80">
                  <span
                    className={`absolute left-3 top-3 z-10 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${rarityBadgeClass(card.rarity)}`}
                  >
                    {card.rarity}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote card art from many CDNs */}
                  <img
                    src={card.imageUrl}
                    alt=""
                    className="h-full w-full object-contain p-3 transition duration-300 group-hover:scale-[1.03]"
                  />
                </div>
                <div className="border-t border-white/5 bg-surface-raised/95 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="line-clamp-2 text-sm font-bold text-white">{card.name}</h2>
                    <CollectionCardActionMenu
                      card={card}
                      userId={user.id}
                      isOpen={menuOpenUserCardId === card.userCardId}
                      onToggle={() =>
                        setMenuOpenUserCardId((prev) =>
                          prev === card.userCardId ? null : card.userCardId
                        )
                      }
                      onClose={() => setMenuOpenUserCardId(null)}
                      onCardUpdated={() => void load()}
                      onRequestListForSale={() => {
                        setMenuOpenUserCardId(null);
                        setListModalCard(card);
                        const hint = Number(card.marketValueUsd);
                        setListPriceInput(Number.isFinite(hint) && hint > 0 ? hint.toFixed(2) : "");
                        setListModalError(null);
                      }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{card.cardSet}</p>
                  <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-slate-500">
                    <span className="rounded-md bg-white/5 px-1.5 py-0.5">
                      Status: <span className="text-slate-300">{sellingStatusLabel(card.sellingStatus)}</span>
                    </span>
                    {card.sellingStatus === "listed_for_sale" &&
                    Number(card.listingPriceUsd ?? 0) > 0 ? (
                      <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-accent">
                        Asking {formatUsd(card.listingPriceUsd)}
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                    <span
                      className="grid h-6 w-6 place-items-center rounded-full bg-accent/20 text-[10px] font-bold text-accent"
                      aria-hidden
                    >
                      {user.fullName?.charAt(0)?.toUpperCase() ?? "?"}
                    </span>
                    <span className="truncate">{user.fullName}</span>
                    <span className="text-slate-600">·</span>
                    <span>{formatRelativeObtained(card.obtainedAt)}</span>
                  </div>
                  <dl className="mt-4 space-y-2 border-t border-white/5 pt-3 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Current market value</dt>
                      <dd
                        className={`font-medium transition-colors duration-700 ease-out ${
                          hotMarketCardIds.has(card.cardId) ? "text-accent" : "text-slate-200"
                        }`}
                      >
                        {formatUsd(livePricesByExternalCardId[card.cardId])}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">P&amp;L since acquisition</dt>
                      <dd
                        className={`font-medium transition-colors duration-700 ease-out ${
                          hotMarketCardIds.has(card.cardId) ? "text-accent" : "text-slate-200"
                        }`}
                      >
                        {formatPnl(livePricesByExternalCardId[card.cardId], card.acquisitionPriceUsd)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-10 space-y-3">
          {cards.map((card) => (
            <li key={card.userCardId}>
              <article className="flex gap-4 rounded-2xl border border-white/10 bg-surface-raised p-3 transition hover:border-accent/40">
                <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-900/80">
                  <span
                    className={`absolute left-1 top-1 z-10 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${rarityBadgeClass(card.rarity)}`}
                  >
                    {card.rarity}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={card.imageUrl} alt="" className="h-full w-full object-contain p-1" />
                </div>
                <div className="min-w-0 flex-1 py-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-bold text-white">{card.name}</h2>
                    <CollectionCardActionMenu
                      card={card}
                      userId={user.id}
                      isOpen={menuOpenUserCardId === card.userCardId}
                      onToggle={() =>
                        setMenuOpenUserCardId((prev) =>
                          prev === card.userCardId ? null : card.userCardId
                        )
                      }
                      onClose={() => setMenuOpenUserCardId(null)}
                      onCardUpdated={() => void load()}
                      onRequestListForSale={() => {
                        setMenuOpenUserCardId(null);
                        setListModalCard(card);
                        const hint = Number(card.marketValueUsd);
                        setListPriceInput(Number.isFinite(hint) && hint > 0 ? hint.toFixed(2) : "");
                        setListModalError(null);
                      }}
                    />
                  </div>
                  <p className="text-xs text-slate-500">{card.cardSet}</p>
                  <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-slate-500">
                    <span className="rounded-md bg-white/5 px-1.5 py-0.5">
                      Status: <span className="text-slate-300">{sellingStatusLabel(card.sellingStatus)}</span>
                    </span>
                    {card.sellingStatus === "listed_for_sale" &&
                    Number(card.listingPriceUsd ?? 0) > 0 ? (
                      <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-accent">
                        Asking {formatUsd(card.listingPriceUsd)}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {user.fullName} · {formatRelativeObtained(card.obtainedAt)}
                  </p>
                  <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                    <div>
                      <dt className="text-slate-500">Market value</dt>
                      <dd
                        className={`font-medium transition-colors duration-700 ease-out ${
                          hotMarketCardIds.has(card.cardId) ? "text-accent" : "text-slate-200"
                        }`}
                      >
                        {formatUsd(livePricesByExternalCardId[card.cardId])}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">P&amp;L</dt>
                      <dd
                        className={`font-medium transition-colors duration-700 ease-out ${
                          hotMarketCardIds.has(card.cardId) ? "text-accent" : "text-slate-200"
                        }`}
                      >
                        {formatPnl(livePricesByExternalCardId[card.cardId], card.acquisitionPriceUsd)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      {listModalCard && user ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="list-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h2 id="list-modal-title" className="text-lg font-semibold text-white">
              List for sale
            </h2>
            <p className="mt-1 text-sm text-slate-400">{listModalCard.name}</p>
            <label className="mt-5 block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Listing price (USD)
              </span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={listPriceInput}
                onChange={(e) => setListPriceInput(e.target.value)}
                placeholder="e.g. 24.99"
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2.5 text-sm text-white outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/30"
              />
            </label>
            {listModalError ? (
              <p className="mt-3 text-sm text-red-300" role="alert">
                {listModalError}
              </p>
            ) : null}
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
                  A <span className="font-semibold text-amber-300">{MARKETPLACE_SELLER_PREMIUM_RATE_PERCENT}% platform fee</span> is deducted from your proceeds when your card sells. Buyers pay no additional premium on top of your listed price.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={listModalSubmitting}
                onClick={() => {
                  setListModalCard(null);
                  setListPriceInput("");
                  setListModalError(null);
                }}
                className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={listModalSubmitting || !listPriceInput.trim()}
                onClick={() => void submitListForSale()}
                className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-accent-glow transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
              >
                {listModalSubmitting ? "Listing…" : "List on marketplace"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
