"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import {
  ApiRequestError,
  apiGetJson,
  apiPostJson,
  commitPackFairness,
  getPackAvailabilityWsUrl,
  type PackFairnessCommitResponse
} from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import PackOpener from "./PackOpener";

interface Drop {
  id: string;
  name: string;
  status: string;
  startTime: string;
  durationMinutes: number;
  /** New since provably-fair B4: server returns "fairness" or "legacy". Defaults to "fairness". */
  fairnessMode?: "fairness" | "legacy";
  packs?: Pack[];
}

interface Pack {
  id: string;
  tierName: string;
  priceUsd: string;
  availableCount: number;
}

interface TierAvailabilitySnapshot {
  dropId: string;
  tierId: string;
  availableCount: number;
}

interface PackPurchaseSuccessEvent {
  type: "pack_purchase_success";
  userId: string;
  dropId: string;
  tierId: string;
  packId: string;
  userPackId: string;
  userCardCount: number;
  purchasedAt: string;
  cards: Array<{
    cardId: string;
    name: string;
    cardSet: string;
    rarity: string;
    marketValueUsd: string;
    imageUrl: string;
  }>;
}

const TIER_CONFIG: Record<string, {
  color: string;
  gradient: string;
  borderColor: string;
  glowColor: string;
  badge: string;
  image: string;
}> = {
  elite: {
    color: 'text-cyan-400',
    gradient: 'from-cyan-500/20 via-transparent to-transparent',
    borderColor: 'border-cyan-500/40',
    glowColor: 'shadow-cyan-500/20',
    badge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    image: "/images/tiers/elite-pack.png"
  },
  pinnacle: {
    color: 'text-amber-400',
    gradient: 'from-amber-500/20 via-transparent to-transparent',
    borderColor: 'border-amber-500/40',
    glowColor: 'shadow-amber-500/20',
    badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    image: "/images/tiers/pinnacle-pack.png"
  },
  zenith: {
    color: 'text-purple-400',
    gradient: 'from-purple-500/20 via-transparent to-transparent',
    borderColor: 'border-purple-500/40',
    glowColor: 'shadow-purple-500/20',
    badge: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    image: "/images/tiers/zenith-pack.png"
  }
};

const DEFAULT_CONFIG = {
  color: 'text-slate-400',
  gradient: 'from-slate-500/10 via-transparent to-transparent',
  borderColor: 'border-white/10',
  glowColor: 'shadow-transparent',
  badge: 'bg-white/5 text-slate-400 border-white/10',
  image: "/images/tiers/default-pack.svg"
};

function getTierConfig(tierName: string) {
  return TIER_CONFIG[tierName.toLowerCase()] ?? DEFAULT_CONFIG;
}


function isPackPurchaseSuccessEvent(payload: unknown): payload is PackPurchaseSuccessEvent {
  if (!payload || typeof payload !== "object") return false;
  const parsed = payload as Partial<PackPurchaseSuccessEvent>;
  return (
    parsed.type === "pack_purchase_success" &&
    typeof parsed.userId === "string" &&
    typeof parsed.dropId === "string" &&
    typeof parsed.tierId === "string" &&
    typeof parsed.packId === "string" &&
    typeof parsed.userPackId === "string" &&
    typeof parsed.userCardCount === "number" &&
    Array.isArray(parsed.cards)
  );
}

export default function DropSalePage() {
  const { token, user } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const [dropName, setDropName] = useState("Upcoming Drop");
  const [isDropLive, setIsDropLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedDropId, setSelectedDropId] = useState<string | null>(null);
  const [fairnessMode, setFairnessMode] = useState<"fairness" | "legacy">("fairness");
  const [packs, setPacks] = useState<Pack[]>([]);
  const [availabilityByTier, setAvailabilityByTier] = useState<Record<string, number>>({});
  const [purchasePendingTier, setPurchasePendingTier] = useState<string | null>(null);
  const [confirmTier, setConfirmTier] = useState<string | null>(null);
  const [purchaseFlash, setPurchaseFlash] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseDetails, setPurchaseDetails] = useState<PackPurchaseSuccessEvent | null>(null);
  /** Phase 1 commit pre-pinned to the confirmation modal session; null until the user opens the modal on a fairness drop. */
  const [fairnessCommit, setFairnessCommit] = useState<PackFairnessCommitResponse | null>(null);
  const [fairnessCommitPending, setFairnessCommitPending] = useState(false);
  const [fairnessCommitError, setFairnessCommitError] = useState<string | null>(null);
  const [clientSeedInput, setClientSeedInput] = useState("");
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0
  });

  useEffect(() => {
    let intervalId: number | null = null;
    let isActive = true;

    void apiGetJson<Drop[]>("/drops")
      .then((drops) => {
        if (!isActive || !drops || drops.length === 0) return;

        const now = Date.now();
        let targetDrop = drops.find((d) => d.status === "live" || Date.parse(d.startTime) > now);
        if (!targetDrop) {
          targetDrop = drops[0];
        }

        const dropStartTimeMs = Date.parse(targetDrop.startTime);
        setDropName(targetDrop.name || "Upcoming Drop");
        setSelectedDropId(targetDrop.id);
        setFairnessMode(targetDrop.fairnessMode === "legacy" ? "legacy" : "fairness");
        setPacks(Array.isArray(targetDrop.packs) ? targetDrop.packs : []);
        setAvailabilityByTier({});

        if (token) {
           const wsUrl = getPackAvailabilityWsUrl(token);
           if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
             const ws = new WebSocket(wsUrl);
             wsRef.current = ws;
             ws.onopen = () => {
               if (!user?.id) return;
               ws.send(
                 JSON.stringify({
                   type: "drop_user_init",
                   userId: user.id
                 })
               );
             };
             ws.onmessage = (event) => {
               try {
                 const payload = JSON.parse(String(event.data)) as
                   | { type?: string; tiers?: TierAvailabilitySnapshot[] }
                   | PackPurchaseSuccessEvent;
                 if (payload.type === "tier_availability_snapshot" && Array.isArray(payload.tiers)) {
                   const tiers = payload.tiers;
                   setAvailabilityByTier(() => {
                     const next: Record<string, number> = {};
                     for (const row of tiers) {
                       if (!row || row.dropId !== targetDrop.id) continue;
                       next[row.tierId] = row.availableCount;
                     }
                     return next;
                   });
                   return;
                 }
                 if (isPackPurchaseSuccessEvent(payload)) {
                   if (!user?.id || payload.userId !== user.id) return;
                   setPurchaseDetails(payload);
                   setPurchaseFlash(
                     `Purchase complete: ${payload.tierId} pack assigned (${payload.userCardCount} cards).`
                   );
                 }
               } catch {
                 // ignore malformed websocket messages
               }
             };
           }
        }

        const updateTimer = () => {
          const currentTime = Date.now();
          let targetTimeMs = dropStartTimeMs;
          const dropIsLive = targetDrop.status === "live" || currentTime >= dropStartTimeMs;
          setIsDropLive(dropIsLive);
          
          if (dropIsLive) {
            // Drop is live, count down to end time
            targetTimeMs = dropStartTimeMs + (targetDrop.durationMinutes || 10) * 60 * 1000;
          }

          const distance = targetTimeMs - currentTime;
          if (distance <= 0) {
            setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
            return;
          }

          setTimeLeft({
            days: Math.floor(distance / (1000 * 60 * 60 * 24)),
            hours: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
            minutes: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
            seconds: Math.floor((distance % (1000 * 60)) / 1000)
          });
        };

        updateTimer();
        intervalId = window.setInterval(updateTimer, 1000);
      })
      .catch((err) => {
        console.error("Failed to fetch drops for timer:", err);
      })
      .finally(() => {
        if (isActive) setLoading(false);
      });

    return () => {
      isActive = false;
      if (intervalId != null) window.clearInterval(intervalId);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, user?.id]);
  
  useEffect(() => {
    if (!purchaseFlash) return;
    const t = window.setTimeout(() => setPurchaseFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [purchaseFlash]);

  useEffect(() => {
    if (!purchaseError) return;
    const t = window.setTimeout(() => setPurchaseError(null), 4000);
    return () => window.clearTimeout(t);
  }, [purchaseError]);

  if (loading) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center space-y-6">
        <div className="relative">
          <div className="h-24 w-24 animate-spin rounded-full border-4 border-accent/20 border-t-accent shadow-[0_0_50px_rgba(56,189,248,0.15)]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-12 w-12 animate-pulse rounded-full bg-accent/10" />
          </div>
        </div>
        <div className="flex flex-col items-center gap-3">
          <h2 className="text-2xl font-black tracking-[0.4em] text-white uppercase animate-pulse">Initializing</h2>
          <p className="text-[10px] font-bold tracking-[0.2em] text-slate-500 uppercase">Pullvault Drop Network · v2.0.4</p>
        </div>
      </div>
    );
  }

  const d = String(timeLeft.days).padStart(2, "0");
  const h = String(timeLeft.hours).padStart(2, "0");
  const m = String(timeLeft.minutes).padStart(2, "0");
  const s = String(timeLeft.seconds).padStart(2, "0");

  const priceByTier: Record<string, string> = {};
  for (const pack of packs) {
    if (priceByTier[pack.tierName] == null) {
      priceByTier[pack.tierName] = pack.priceUsd;
    }
  }
  const tierCards = Object.entries(availabilityByTier)
    .map(([tierName, availableCount]) => ({
      tierName,
      availableCount,
      priceUsd: priceByTier[tierName]
    }))
    .sort((a, b) => a.tierName.localeCompare(b.tierName));

  /**
   * Phase 1 of provably-fair: lock a `nonce` + `server_commitment` BEFORE the
   * purchase POST so the eventual draw is bound to a commitment the user has
   * already seen. Legacy drops skip this; `pack-queue/purchases` simply doesn't
   * receive a `nonce` in that case.
   */
  const handleBuyPack = async (tierName: string) => {
    if (!selectedDropId || !token) return;
    if (fairnessMode === "fairness" && !fairnessCommit) {
      setPurchaseError("Generate a fairness session before confirming the purchase.");
      return;
    }
    setPurchasePendingTier(tierName);
    setPurchaseFlash(null);
    setPurchaseError(null);
    setPurchaseDetails(null);
    try {
      const body: Record<string, unknown> = {
        dropId: selectedDropId,
        tierId: tierName
      };
      if (fairnessMode === "fairness" && fairnessCommit) {
        body.nonce = fairnessCommit.nonce;
      }
      await apiPostJson<{ status: "queued"; message: string }>("/pack-queue/purchases", body);
      setPurchaseFlash(`Purchase queued for ${tierName} pack.`);
    } catch (e) {
      setPurchaseError(e instanceof ApiRequestError ? e.message : "Could not queue purchase.");
    } finally {
      setPurchasePendingTier(null);
      setConfirmTier(null);
      setFairnessCommit(null);
      setFairnessCommitError(null);
      setClientSeedInput("");
    }
  };

  const openPurchaseConfirmation = async (tierName: string) => {
    if (purchasePendingTier) return;
    setPurchaseFlash(null);
    setPurchaseError(null);
    setConfirmTier(tierName);
    setFairnessCommit(null);
    setFairnessCommitError(null);
    setClientSeedInput("");

    if (fairnessMode === "fairness" && selectedDropId && token) {
      setFairnessCommitPending(true);
      try {
        const commit = await commitPackFairness(selectedDropId);
        setFairnessCommit(commit);
      } catch (e) {
        setFairnessCommitError(
          e instanceof ApiRequestError
            ? e.message
            : "Could not generate a fairness session. Try again."
        );
      } finally {
        setFairnessCommitPending(false);
      }
    }
  };

  const regenerateFairnessCommit = async () => {
    if (!selectedDropId || !token) return;
    setFairnessCommitError(null);
    setFairnessCommitPending(true);
    try {
      const commit = await commitPackFairness(selectedDropId, clientSeedInput);
      setFairnessCommit(commit);
    } catch (e) {
      setFairnessCommitError(
        e instanceof ApiRequestError
          ? e.message
          : "Could not generate a fairness session. Try again."
      );
    } finally {
      setFairnessCommitPending(false);
    }
  };

  const closeConfirmation = () => {
    setConfirmTier(null);
    setFairnessCommit(null);
    setFairnessCommitError(null);
    setClientSeedInput("");
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden pt-12 lg:pt-24 pb-16 flex items-center justify-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.1),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 bg-hero-radial opacity-70" />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-6 text-center">
        <h1 className="text-balance text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          {dropName}
        </h1>

        <div className="mt-8 rounded-3xl border border-white/10 bg-[#1e293b]/70 p-6 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <p className="mb-6 text-xs font-bold tracking-[0.2em] text-white/90">{isDropLive ? "ENDS IN" : "STARTS IN"}</p>
          <div className="flex items-center justify-center gap-3 sm:gap-6">
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/5 bg-[#0f172a] text-2xl font-bold text-white shadow-inner sm:h-20 sm:w-20 sm:text-3xl">{d}</div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:text-xs">Days</span>
            </div>
            <div className="pb-6 text-2xl font-bold text-white/30">:</div>
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/5 bg-[#0f172a] text-2xl font-bold text-white shadow-inner sm:h-20 sm:w-20 sm:text-3xl">{h}</div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:text-xs">Hours</span>
            </div>
            <div className="pb-6 text-2xl font-bold text-white/30">:</div>
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/5 bg-[#0f172a] text-2xl font-bold text-white shadow-inner sm:h-20 sm:w-20 sm:text-3xl">{m}</div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:text-xs">Minutes</span>
            </div>
            <div className="hidden pb-6 text-2xl font-bold text-white/30 sm:block">:</div>
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/5 bg-[#0f172a] text-2xl font-bold text-white shadow-inner sm:h-20 sm:w-20 sm:text-3xl">{s}</div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:text-xs">Seconds</span>
            </div>
          </div>
        </div>

        {purchaseFlash ? (
          <div className="mt-4 w-full max-w-3xl rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {purchaseFlash}
          </div>
        ) : null}
        {purchaseError ? (
          <div className="mt-4 w-full max-w-3xl rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {purchaseError}
          </div>
        ) : null}
        
        {purchaseDetails ? (
           <PackOpener 
             cards={purchaseDetails.cards} 
             tierId={purchaseDetails.tierId} 
             userPackId={purchaseDetails.userPackId}
             onClose={() => setPurchaseDetails(null)} 
           />
        ) : null}

        <section className="mt-6 w-full max-w-5xl rounded-3xl border border-white/10 bg-[#1e293b]/70 p-6 text-left shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between gap-3 px-2">
            <h2 className="text-lg font-semibold text-white">Packs</h2>
            {!token ? (
              <Link href="/login" className="text-xs text-accent hover:underline">
                Sign in to buy
              </Link>
            ) : null}
          </div>
          {tierCards.length === 0 ? null : (
            <div className="relative w-full">
              <ul className="no-scrollbar flex w-full gap-5 overflow-x-auto pb-4 px-2">
              {tierCards.map((tier) => {
                const availableCount = tier.availableCount ?? 0;
                const totalCount = packs.find(p => p.tierName === tier.tierName)?.availableCount ?? 100; // Fallback to 100 if unknown
                const soldOut = availableCount <= 0;
                const disabled = !token || !isDropLive || soldOut || purchasePendingTier === tier.tierName;
                const config = getTierConfig(tier.tierName);
                const progress = Math.min(100, Math.max(0, (availableCount / totalCount) * 100));

                return (
                  <li 
                    key={tier.tierName} 
                    className={`group relative flex min-w-[260px] flex-col rounded-3xl border ${config.borderColor} bg-slate-900/40 p-5 shadow-2xl transition-all duration-300 hover:-translate-y-1 hover:bg-slate-900/60 ${config.glowColor} hover:shadow-2xl`}
                  >
                    {/* Tier Gradient Overlay */}
                    <div className={`absolute inset-0 rounded-3xl bg-gradient-to-b ${config.gradient} opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />

                    {/* Tier Badge */}
                    <div className="absolute top-4 right-4 z-10">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-wider ${config.badge}`}>
                        {tier.tierName.toUpperCase()}
                      </span>
                    </div>

                    {/* Pack Image Container */}
                    <div className="relative mb-6 flex h-40 items-center justify-center overflow-hidden rounded-2xl bg-slate-950/40 transition-transform duration-500 group-hover:scale-105">
                      <img
                        src={config.image}
                        alt={`${tier.tierName} tier pack`}
                        className="h-full w-full object-contain p-2 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                      />
                    </div>

                    {/* Pack Details */}
                    <div className="relative z-10 flex flex-1 flex-col">
                      <h3 className="text-lg font-bold text-white transition-colors group-hover:text-white/90">
                        {tier.tierName} Pack
                      </h3>
                      
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-2xl font-black text-white">
                          {tier.priceUsd ? `$${tier.priceUsd}` : "N/A"}
                        </span>
                        <span className="text-xs font-medium text-slate-500">per pack</span>
                      </div>

                      {/* Availability Section */}
                      <div className="mt-6 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <span>Availability</span>
                          <span className={soldOut ? "text-rose-500" : config.color}>
                            {soldOut ? "Sold Out" : `${availableCount} Left`}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/50">
                          <div 
                            className={`h-full rounded-full transition-all duration-700 ${soldOut ? "bg-rose-500" : config.color.replace('text-', 'bg-')}`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>

                      {/* Action Button */}
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void openPurchaseConfirmation(tier.tierName)}
                        className={`mt-6 w-full rounded-2xl py-3.5 text-sm font-bold tracking-wide text-slate-950 transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-30 
                          ${soldOut ? "bg-slate-700 text-slate-400" : "bg-white hover:bg-slate-100 hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-black/20"}`}
                      >
                        {purchasePendingTier === tier.tierName ? (
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-950 [animation-delay:-0.3s]"></div>
                            <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-950 [animation-delay:-0.15s]"></div>
                            <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-950"></div>
                          </div>
                        ) : soldOut ? (
                          "Out of Stock"
                        ) : !isDropLive ? (
                          "Coming Soon"
                        ) : !token ? (
                          "Sign in to buy"
                        ) : (
                          "Purchase Now"
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
              </ul>
            </div>
          )}

        </section>
      </div>
      {confirmTier ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f172a] p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white">Confirm Purchase</h3>
            <p className="mt-2 text-sm text-slate-300">
              Queue a purchase for the <span className="font-semibold text-white">{confirmTier}</span> tier?
            </p>

            {fairnessMode === "fairness" ? (
              <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 text-left">
                <div className="flex items-center gap-2 text-emerald-300">
                  <ShieldCheck className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    Provably-fair session
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                  The server locks its <code className="rounded bg-black/30 px-1 py-0.5">server_commitment</code>{" "}
                  before you buy. Your <code className="rounded bg-black/30 px-1 py-0.5">client_seed</code>{" "}
                  also feeds the draw so the platform cannot pick outcomes using only its own
                  secret. After the pack opens you can replay the derivation in your browser on
                  the <span className="font-mono">/verify</span> page.
                </p>

                <label className="mt-3 block text-xs font-medium text-slate-300">
                  Client seed
                  <span className="ml-1 text-slate-500">(optional — server generates one if blank)</span>
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={512}
                    placeholder="Anything you want — e.g. a memorable phrase"
                    value={clientSeedInput}
                    onChange={(e) => setClientSeedInput(e.target.value)}
                    disabled={fairnessCommitPending || purchasePendingTier === confirmTier}
                    className="flex-1 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => void regenerateFairnessCommit()}
                    disabled={fairnessCommitPending || purchasePendingTier === confirmTier}
                    className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {fairnessCommitPending ? "…" : "Apply"}
                  </button>
                </div>

                {fairnessCommitError ? (
                  <p className="mt-2 text-xs text-rose-300">{fairnessCommitError}</p>
                ) : null}

                {fairnessCommit ? (
                  <dl className="mt-3 space-y-1.5 text-[11px] text-slate-400">
                    <div>
                      <dt className="inline text-slate-500">Fairness session ID: </dt>
                      <dd className="inline break-all font-mono text-slate-200">
                        {fairnessCommit.nonce}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-slate-500">Server commitment: </dt>
                      <dd className="inline break-all font-mono text-slate-200">
                        {fairnessCommit.server_commitment}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-slate-500">Client seed used: </dt>
                      <dd className="inline break-all font-mono text-slate-200">
                        {fairnessCommit.client_seed}
                      </dd>
                      <span className="ml-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                        {fairnessCommit.client_seed_source}
                      </span>
                    </div>
                  </dl>
                ) : fairnessCommitPending ? (
                  <p className="mt-3 text-xs text-slate-400">Locking server commitment…</p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={purchasePendingTier === confirmTier}
                onClick={closeConfirmation}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  purchasePendingTier === confirmTier ||
                  fairnessCommitPending ||
                  (fairnessMode === "fairness" && !fairnessCommit)
                }
                onClick={() => void handleBuyPack(confirmTier)}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {purchasePendingTier === confirmTier ? "Queuing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
