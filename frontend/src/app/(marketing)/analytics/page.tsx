"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiRequestError,
  getEarningsEvents,
  getEarningsOverview,
  getEarningsTimeseries,
  type EarningsEventType,
  type EarningsEventsResponse,
  type EarningsOverviewResponse,
  type EarningsRangePreset,
  type EarningsSortOrder,
  type EarningsTimeseriesResponse
} from "@/lib/api";

const RANGE_OPTIONS: EarningsRangePreset[] = ["24h", "7d", "30d", "90d", "ytd", "all"];
const EVENT_TYPES: EarningsEventType[] = ["marketplace_purchase", "auction_completion", "pack_purchase"];
const PAGE_SIZE = 25;

function formatUsd(value: string | undefined): string {
  if (!value) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function eventTypeLabel(type: EarningsEventType): string {
  if (type === "marketplace_purchase") return "Marketplace";
  if (type === "auction_completion") return "Auction";
  return "Pack sale";
}

function formatIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<EarningsRangePreset>("30d");
  const [eventTypes, setEventTypes] = useState<EarningsEventType[]>([...EVENT_TYPES]);
  const [order, setOrder] = useState<EarningsSortOrder>("desc");
  const [overviewSortBy, setOverviewSortBy] = useState<"amount" | "events" | "average">("amount");
  const [groupBy, setGroupBy] = useState<"hour" | "day" | "week" | "month">("day");
  const [eventsSortBy, setEventsSortBy] = useState<"occurred_at" | "amount_gained_usd" | "event_type" | "created_at">(
    "occurred_at"
  );
  const [offset, setOffset] = useState(0);

  const [overview, setOverview] = useState<EarningsOverviewResponse | null>(null);
  const [timeseries, setTimeseries] = useState<EarningsTimeseriesResponse | null>(null);
  const [events, setEvents] = useState<EarningsEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canGoPrev = offset > 0;
  const canGoNext = (events?.events.length ?? 0) === PAGE_SIZE;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [overviewRes, timeseriesRes, eventsRes] = await Promise.all([
          getEarningsOverview({
            range,
            eventTypes,
            order,
            sortBy: overviewSortBy
          }),
          getEarningsTimeseries({
            range,
            eventTypes,
            order,
            groupBy
          }),
          getEarningsEvents({
            range,
            eventTypes,
            order,
            sortBy: eventsSortBy,
            limit: PAGE_SIZE,
            offset
          })
        ]);

        if (!cancelled) {
          setOverview(overviewRes);
          setTimeseries(timeseriesRes);
          setEvents(eventsRes);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiRequestError ? e.message : "Could not load earnings analytics.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [range, eventTypes, order, overviewSortBy, groupBy, eventsSortBy, offset]);

  const maxPointValue = useMemo(() => {
    const vals = (timeseries?.points ?? []).map((p) => Number(p.totalAmountGainedUsd)).filter((n) => Number.isFinite(n));
    if (vals.length === 0) return 0;
    return Math.max(...vals);
  }, [timeseries?.points]);

  const toggleEventType = (type: EarningsEventType) => {
    setOffset(0);
    setEventTypes((prev) => {
      if (prev.includes(type)) {
        const next = prev.filter((t) => t !== type);
        return next.length > 0 ? next : prev;
      }
      return [...prev, type];
    });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 md:pt-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Earnings Analytics</h1>
        <p className="mt-1 text-sm text-slate-400">Revenue dashboard across marketplace, auctions, and pack sales.</p>
      </header>

      <section className="rounded-2xl border border-white/10 bg-surface-raised/60 p-4">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <label className="text-xs text-slate-400">
            Range
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm text-white"
              value={range}
              onChange={(e) => {
                setOffset(0);
                setRange(e.target.value as EarningsRangePreset);
              }}
            >
              {RANGE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r.toUpperCase()}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-slate-400">
            Order
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm text-white"
              value={order}
              onChange={(e) => {
                setOffset(0);
                setOrder(e.target.value as EarningsSortOrder);
              }}
            >
              <option value="desc">DESC</option>
              <option value="asc">ASC</option>
            </select>
          </label>

          <label className="text-xs text-slate-400">
            Source sort
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm text-white"
              value={overviewSortBy}
              onChange={(e) => setOverviewSortBy(e.target.value as "amount" | "events" | "average")}
            >
              <option value="amount">Amount</option>
              <option value="events">Events</option>
              <option value="average">Average</option>
            </select>
          </label>

          <label className="text-xs text-slate-400">
            Timeseries group
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm text-white"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as "hour" | "day" | "week" | "month")}
            >
              <option value="hour">Hour</option>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>

          <label className="text-xs text-slate-400">
            Events sort
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm text-white"
              value={eventsSortBy}
              onChange={(e) =>
                setEventsSortBy(e.target.value as "occurred_at" | "amount_gained_usd" | "event_type" | "created_at")
              }
            >
              <option value="occurred_at">Occurred at</option>
              <option value="amount_gained_usd">Amount gained</option>
              <option value="event_type">Event type</option>
              <option value="created_at">Created at</option>
            </select>
          </label>

          <div className="text-xs text-slate-400">
            Window
            <div className="mt-1 rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-xs text-slate-300">
              {overview?.window.fromIso ? formatIso(overview.window.fromIso) : "Beginning"} →{" "}
              {overview?.window.toIso ? formatIso(overview.window.toIso) : "Now"}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {EVENT_TYPES.map((type) => {
            const active = eventTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleEventType(type)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  active
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                {eventTypeLabel(type)}
              </button>
            );
          })}
        </div>
      </section>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-white/10 bg-surface-raised p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total earned</p>
          <p className="mt-2 text-2xl font-bold text-accent">{formatUsd(overview?.summary.totalAmountGainedUsd)}</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-surface-raised p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total events</p>
          <p className="mt-2 text-2xl font-bold text-white">{overview?.summary.totalEvents ?? "—"}</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-surface-raised p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Avg per event</p>
          <p className="mt-2 text-2xl font-bold text-white">{formatUsd(overview?.summary.averagePerEventUsd)}</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-surface-raised p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Largest single gain</p>
          <p className="mt-2 text-2xl font-bold text-white">{formatUsd(overview?.summary.largestSingleGainUsd)}</p>
        </article>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-surface-raised p-4">
          <h2 className="text-sm font-semibold text-white">Revenue by source</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2">Source</th>
                  <th className="pb-2">Total</th>
                  <th className="pb-2">Events</th>
                  <th className="pb-2">Avg</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {(overview?.sourceBreakdown ?? []).map((row) => (
                  <tr key={row.eventType} className="border-t border-white/5">
                    <td className="py-2">{eventTypeLabel(row.eventType)}</td>
                    <td className="py-2 font-semibold">{formatUsd(row.totalAmountGainedUsd)}</td>
                    <td className="py-2">{row.totalEvents}</td>
                    <td className="py-2">{formatUsd(row.averagePerEventUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-surface-raised p-4">
          <h2 className="text-sm font-semibold text-white">Revenue trend</h2>
          <div className="mt-3 space-y-2">
            {(timeseries?.points ?? []).map((point) => {
              const amount = Number(point.totalAmountGainedUsd);
              const widthPct = maxPointValue > 0 ? Math.max((amount / maxPointValue) * 100, 2) : 0;
              return (
                <div key={point.bucketStart}>
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                    <span>{formatIso(point.bucketStart)}</span>
                    <span>{formatUsd(point.totalAmountGainedUsd)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10">
                    <div className="h-2 rounded-full bg-accent" style={{ width: `${widthPct}%` }} />
                  </div>
                </div>
              );
            })}
            {!loading && (timeseries?.points.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-500">No points for selected filters.</p>
            ) : null}
          </div>
        </article>
      </section>

      <section className="mt-6 rounded-2xl border border-white/10 bg-surface-raised p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Earnings ledger events</h2>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canGoPrev}
              onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={!canGoNext}
              onClick={() => setOffset((v) => v + PAGE_SIZE)}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="pb-2">Occurred</th>
                <th className="pb-2">Source</th>
                <th className="pb-2">Amount gained</th>
                <th className="pb-2">Transaction</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {(events?.events ?? []).map((event) => (
                <tr key={event.id} className="border-t border-white/5">
                  <td className="py-2">{formatIso(event.occurredAt)}</td>
                  <td className="py-2">{eventTypeLabel(event.eventType)}</td>
                  <td className="py-2 font-semibold">{formatUsd(event.amountGainedUsd)}</td>
                  <td className="py-2 font-mono text-xs text-slate-400">{event.transactionId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && (events?.events.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No events for selected filters.</p>
        ) : null}
      </section>
    </div>
  );
}
