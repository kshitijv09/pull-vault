"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ApiRequestError,
  getPlatformHealthSummary,
  type EconomicsPanel,
  type FairnessPanel,
  type FraudPanel,
  type PlatformHealthRangePreset,
  type PlatformHealthSummaryResponse,
  type UserHealthPanel
} from "@/lib/api";

const RANGE_OPTIONS: PlatformHealthRangePreset[] = ["24h", "7d", "30d", "90d", "ytd", "all"];
/**
 * Auto-poll cadence. The fraud panel is the only one expected to move
 * second-to-second; matching its server-side cache TTL gives the operator a
 * near-live view without hammering the API.
 */
const POLL_INTERVAL_MS = 10_000;

function formatPct(value: string | null, options?: { fraction?: boolean }): string {
  if (value === null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const pct = (options?.fraction ?? true) ? n * 100 : n;
  return `${pct.toFixed(2)}%`;
}

function formatUsd(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

function formatIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function badgeColour(badge: "green" | "yellow" | "red"): string {
  if (badge === "red") return "bg-red-500/20 text-red-200";
  if (badge === "yellow") return "bg-amber-500/20 text-amber-200";
  return "bg-emerald-500/20 text-emerald-200";
}

export default function PlatformHealthPage() {
  const [range, setRange] = useState<PlatformHealthRangePreset>("24h");
  const [data, setData] = useState<PlatformHealthSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await getPlatformHealthSummary({ range });
      setData(res);
      setLastUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Could not load platform health summary.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    setLoading(true);
    void load();
    const t = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 md:pt-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
            Platform Health Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Fraud, economic, fairness, and user health signals — all on one page.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Auto-refresh every {POLL_INTERVAL_MS / 1000}s · last updated{" "}
            {lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString() : "—"}
          </p>
        </div>
        <div className="flex gap-3">
          <label className="text-xs text-slate-400">
            Range
            <select
              className="ml-2 rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm text-white"
              value={range}
              onChange={(e) => setRange(e.target.value as PlatformHealthRangePreset)}
            >
              {RANGE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <Link
            href="/analytics"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10"
          >
            Earnings →
          </Link>
        </div>
      </header>

      {error ? (
        <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-slate-400">Loading health summary…</p>
      ) : null}

      {data ? (
        <div className="space-y-8">
          <PanelFraud panel={data.fraud} />

          <PanelEconomics panel={data.economics} />

          <PanelFairness panel={data.fairness} />

          <PanelUserHealth panel={data.users} />
        </div>
      ) : null}
    </div>
  );
}

function PanelFraud({ panel }: { panel: FraudPanel }) {
  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-white">Fraud signals</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <KpiCard
          title="Rate-limit blocks"
          value={formatNumber(panel.rateLimit.totalBlocks)}
          subtitle={`${formatPct(panel.rateLimit.blockShareOfAttempts)} of attempts (vs ${formatNumber(panel.rateLimit.totalAcceptedPurchases)} accepted)`}
        />
        <KpiCard
          title="Auction fraud flag rate"
          value={formatPct(panel.auctionFraud.flagRate)}
          subtitle={`${formatNumber(panel.auctionFraud.needsFraudReviewCount)} flagged / ${formatNumber(panel.auctionFraud.settledCount)} settled`}
        />
        <KpiCard
          title="Sealed-phase rate"
          value={formatPct(panel.auctionFraud.sealedPhaseRate)}
          subtitle="Auctions that escalated to sealed bidding"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-surface-raised p-4">
          <h3 className="text-sm font-semibold text-white">Blocks by scope</h3>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="pb-2">Scope</th>
                <th className="pb-2 text-right">Count</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {panel.rateLimit.byScope.length === 0 ? (
                <tr>
                  <td colSpan={2} className="pt-3 text-sm text-slate-500">
                    No blocks in this window.
                  </td>
                </tr>
              ) : (
                panel.rateLimit.byScope.map((r) => (
                  <tr key={r.scope} className="border-t border-white/5">
                    <td className="py-2 font-mono text-xs">{r.scope}</td>
                    <td className="py-2 text-right">{formatNumber(r.count)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </article>

        <article className="rounded-2xl border border-white/10 bg-surface-raised p-4">
          <h3 className="text-sm font-semibold text-white">Top blocked IPs</h3>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="pb-2">IP</th>
                <th className="pb-2 text-right">Blocks</th>
                <th className="pb-2 text-right">Share</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {panel.topBlockedIps.length === 0 ? (
                <tr>
                  <td colSpan={3} className="pt-3 text-sm text-slate-500">
                    No IPs have been blocked yet.
                  </td>
                </tr>
              ) : (
                panel.topBlockedIps.map((r) => (
                  <tr key={r.clientIp} className="border-t border-white/5">
                    <td className="py-2 font-mono text-xs">{r.clientIp}</td>
                    <td className="py-2 text-right">{formatNumber(r.blocks)}</td>
                    <td className="py-2 text-right">{formatPct(r.shareOfTotal)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </article>
      </div>
    </section>
  );
}

function PanelEconomics({ panel }: { panel: EconomicsPanel }) {
  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-white">Economic health</h2>
      <div className="grid gap-4 lg:grid-cols-4">
        <KpiCard
          title="Pack revenue (24h burn)"
          value={formatUsd(panel.revenue.packPurchase.projectedNext24hUsd)}
          subtitle={`7-day projection: ${formatUsd(panel.revenue.packPurchase.projectedNext7dUsd)}`}
        />
        <KpiCard
          title="Marketplace revenue (24h)"
          value={formatUsd(panel.revenue.marketplacePurchase.projectedNext24hUsd)}
          subtitle={`7-day projection: ${formatUsd(panel.revenue.marketplacePurchase.projectedNext7dUsd)}`}
        />
        <KpiCard
          title="Auction revenue (24h)"
          value={formatUsd(panel.revenue.auctionCompletion.projectedNext24hUsd)}
          subtitle={`7-day projection: ${formatUsd(panel.revenue.auctionCompletion.projectedNext7dUsd)}`}
        />
        <KpiCard
          title="Total revenue (window)"
          value={formatUsd(panel.revenue.total.totalRevenueUsd)}
          subtitle="Sum across event types in selected range"
        />
      </div>

      <article className="rounded-2xl border border-white/10 bg-surface-raised p-4">
        <h3 className="text-sm font-semibold text-white">Per-tier margin & win rate</h3>
        <p className="mt-1 text-xs text-slate-500">
          Realised value comes from `card.market_value_usd` joined on `user_cards`. Margin gap is
          `actual − target`; negative gaps below −5pp fire `tier_margin_breach`.
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-2">Tier</th>
              <th className="pb-2 text-right">Packs</th>
              <th className="pb-2 text-right">Retail</th>
              <th className="pb-2 text-right">Realised</th>
              <th className="pb-2 text-right">Actual margin</th>
              <th className="pb-2 text-right">Target</th>
              <th className="pb-2 text-right">Gap (pp)</th>
              <th className="pb-2 text-right">Win rate</th>
            </tr>
          </thead>
          <tbody className="text-slate-200">
            {panel.tiers.length === 0 ? (
              <tr>
                <td colSpan={8} className="pt-3 text-sm text-slate-500">
                  No packs opened in this window.
                </td>
              </tr>
            ) : (
              panel.tiers.map((tier) => (
                <tr key={tier.tierName} className="border-t border-white/5">
                  <td className="py-2 font-mono text-xs">{tier.tierName}</td>
                  <td className="py-2 text-right">{formatNumber(tier.packsOpened)}</td>
                  <td className="py-2 text-right">{formatUsd(tier.retailRevenueUsd)}</td>
                  <td className="py-2 text-right">{formatUsd(tier.realisedValueUsd)}</td>
                  <td className="py-2 text-right">{formatPct(tier.actualMargin)}</td>
                  <td className="py-2 text-right">{formatPct(tier.targetMargin)}</td>
                  <td
                    className={`py-2 text-right ${
                      tier.marginGapPp && Number(tier.marginGapPp) < -0.05
                        ? "text-red-300"
                        : tier.marginGapPp && Number(tier.marginGapPp) < 0
                          ? "text-amber-200"
                          : "text-slate-200"
                    }`}
                  >
                    {formatPct(tier.marginGapPp)}
                  </td>
                  <td className="py-2 text-right">{formatPct(tier.winRate)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </article>

      <article className="rounded-2xl border border-white/10 bg-surface-raised p-4">
        <h3 className="text-sm font-semibold text-white">Pool drift (live drops)</h3>
        <p className="mt-1 text-xs text-slate-500">
          Compares `drop_card_pool_snapshot.market_value_usd_snapshot` against current
          `card.market_value_usd`. Median ≥ 5% fires `pool_price_drift` warning.
        </p>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-2">Drop</th>
              <th className="pb-2 text-right">Median drift</th>
              <th className="pb-2 text-right">Max drift</th>
              <th className="pb-2 text-right">Cards</th>
              <th className="pb-2">Pinned at</th>
            </tr>
          </thead>
          <tbody className="text-slate-200">
            {panel.pools.length === 0 ? (
              <tr>
                <td colSpan={5} className="pt-3 text-sm text-slate-500">
                  No live drops with pinned pool snapshots.
                </td>
              </tr>
            ) : (
              panel.pools.map((pool) => (
                <tr key={pool.dropId} className="border-t border-white/5">
                  <td className="py-2">{pool.dropName}</td>
                  <td className="py-2 text-right">{formatPct(pool.medianDriftPct, { fraction: false })}</td>
                  <td className="py-2 text-right">{formatPct(pool.maxDriftPct, { fraction: false })}</td>
                  <td className="py-2 text-right">{formatNumber(pool.cardsCompared)}</td>
                  <td className="py-2 text-xs text-slate-400">
                    {formatIso(pool.poolSnapshotCreatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </article>

    </section>
  );
}

function PanelFairness({ panel }: { panel: FairnessPanel }) {
  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-white">Fairness audit</h2>
      <div className="grid gap-4 lg:grid-cols-4">
        <KpiCard
          title="Consumed commits"
          value={formatNumber(panel.usage.totalConsumedCommits)}
          subtitle="Phase 1 commits whose draw has been resolved"
        />
        <KpiCard
          title="Reveals fetched"
          value={formatNumber(panel.usage.totalReveals)}
          subtitle="Phase 3 reveal endpoint hits"
        />
        <KpiCard
          title="Distinct packs verified"
          value={formatNumber(panel.usage.distinctUserPacksVerified)}
          subtitle="Phase 4 browser-only replays"
        />
        <KpiCard
          title="Verifier fails"
          value={formatNumber(panel.usage.failedVerifyEvents)}
          subtitle={`${formatNumber(panel.usage.totalVerifyEvents)} total beacon pings`}
          accent={panel.usage.failedVerifyEvents > 0 ? "danger" : undefined}
        />
      </div>

    </section>
  );
}

function PanelUserHealth({ panel }: { panel: UserHealthPanel }) {
  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-white">User health</h2>
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest ${badgeColour(panel.badge)}`}
        >
          {panel.badge}
        </span>
        <span className="text-xs text-slate-400">composite of the four signals below</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-4">
        <KpiCard title="DAU" value={formatNumber(panel.dau)} subtitle="Distinct active users / 24h" />
        <KpiCard title="WAU" value={formatNumber(panel.wau)} subtitle="Distinct active users / 7d" />
        <KpiCard title="MAU" value={formatNumber(panel.mau)} subtitle="Distinct active users / 30d" />
        <KpiCard
          title="DAU / MAU"
          value={formatPct(panel.dauOverMau)}
          subtitle="Stickiness — Roblox-style metric"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-4">
        <KpiCard
          title="Drop participation"
          value={formatPct(panel.dropParticipationRate)}
          subtitle="Buyers / users active during drops"
        />
        <KpiCard
          title="Auction participation"
          value={formatPct(panel.auctionParticipationRate)}
          subtitle="Listings with bids / settled listings"
        />
        <KpiCard
          title="Pack → list 24h"
          value={formatPct(panel.packToListConversion24h)}
          subtitle="Cards listed within 24h of pull (yellow ≥ 35%)"
        />
        <KpiCard
          title="D7 retention"
          value={formatPct(panel.retention.d7)}
          subtitle={`Cohort: ${formatIso(panel.retention.cohortStart)}`}
        />
      </div>
      <article className="rounded-2xl border border-white/10 bg-surface-raised p-4">
        <h3 className="text-sm font-semibold text-white">Badge breakdown</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {panel.badgeBreakdown.map((row) => (
            <li key={row.signal} className="flex items-center gap-3 border-t border-white/5 pt-2 first:border-0 first:pt-0">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  row.status === "red"
                    ? "bg-red-400"
                    : row.status === "yellow"
                      ? "bg-amber-400"
                      : "bg-emerald-400"
                }`}
              />
              <span className="text-slate-200">{row.signal}</span>
              <span className="ml-auto font-mono text-xs text-slate-300">
                {row.value !== null ? formatPct(row.value) : "—"}
              </span>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  accent
}: {
  title: string;
  value: string;
  subtitle?: string;
  accent?: "danger";
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-surface-raised p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p
        className={`mt-2 text-2xl font-bold ${
          accent === "danger" ? "text-red-300" : "text-white"
        }`}
      >
        {value}
      </p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </article>
  );
}
