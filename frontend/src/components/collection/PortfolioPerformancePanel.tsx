"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiRequestError,
  apiGetJson,
  createPortfolioSnapshot,
  type PortfolioComputation,
  type PortfolioHistoryRange,
  type PortfolioSnapshotsPayload
} from "@/lib/api";

const RANGES: { id: PortfolioHistoryRange; label: string }[] = [
  { id: "1d", label: "1D" },
  { id: "1w", label: "1W" },
  { id: "1m", label: "1M" },
  { id: "ytd", label: "YTD" }
];

function formatUsd(value: string | undefined): string {
  if (!value) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function portfolioPnLUsd(computed: PortfolioComputation | null): string {
  if (!computed) return "0.00";
  const m = Number(computed.totalPortfolioValueUsd);
  const a = Number(computed.totalAcquisitionCostUsd);
  if (!Number.isFinite(m) || !Number.isFinite(a)) return "0.00";
  return (m - a).toFixed(2);
}

function buildSeries(
  points: PortfolioSnapshotsPayload["points"],
  liveTotalUsd: string | undefined
): { t: number; v: number }[] {
  const base = points
    .map((p) => ({ t: Date.parse(p.recordedAt), v: Number(p.totalPortfolioValueUsd) }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.v));
  const live = Number(liveTotalUsd);
  if (Number.isFinite(live)) {
    const last = base[base.length - 1];
    if (!last || last.v !== live || last.t < Date.now() - 60_000) {
      base.push({ t: Date.now(), v: live });
    }
  }
  if (base.length === 1) {
    const only = base[0];
    base.push({ t: only.t + 86_400_000, v: only.v });
  }
  return base;
}

function chartPath(series: { t: number; v: number }[], width: number, height: number): { line: string; area: string } {
  if (series.length === 0) {
    return { line: "", area: "" };
  }
  const padX = 8;
  const padY = 10;
  const w = width - padX * 2;
  const h = height - padY * 2;
  const ts = series.map((s) => s.t);
  const vs = series.map((s) => s.v);
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);
  const vMin = Math.min(...vs);
  const vMax = Math.max(...vs);
  const tSpan = tMax - tMin || 1;
  const vSpanRaw = vMax - vMin;
  const vPad = vSpanRaw === 0 ? Math.max(vMax * 0.02, 0.01) : vSpanRaw * 0.08;
  const vLow = vMin - vPad;
  const vHigh = vMax + vPad;
  const vSpan = vHigh - vLow || 1;

  const xy = series.map((s) => {
    const x = padX + ((s.t - tMin) / tSpan) * w;
    const y = padY + (1 - (s.v - vLow) / vSpan) * h;
    return { x, y };
  });

  const line = xy.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area =
    xy.length > 0
      ? `${line} L ${xy[xy.length - 1].x.toFixed(1)} ${(height - padY).toFixed(1)} L ${xy[0].x.toFixed(1)} ${(height - padY).toFixed(1)} Z`
      : "";

  return { line, area };
}

function rangeChangeLabel(
  series: { t: number; v: number }[],
  liveTotalUsd: string | undefined
): number | null {
  if (series.length < 2) return null;
  const first = series[0].v;
  const last = Number(liveTotalUsd);
  const end = Number.isFinite(last) ? last : series[series.length - 1].v;
  if (!Number.isFinite(first) || first === 0 || !Number.isFinite(end)) return null;
  return ((end - first) / first) * 100;
}

type Props = {
  userId: string;
};

export function PortfolioPerformancePanel({ userId }: Props) {
  const [range, setRange] = useState<PortfolioHistoryRange>("1m");
  const [computed, setComputed] = useState<PortfolioComputation | null>(null);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshotsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshotSaving, setSnapshotSaving] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [valueData, snapData] = await Promise.all([
        apiGetJson<PortfolioComputation>(`/users/${userId}/portfolio/value`),
        apiGetJson<PortfolioSnapshotsPayload>(`/users/${userId}/portfolio/snapshots`, { range })
      ]);
      setComputed(valueData);
      setSnapshots(snapData);
    } catch (e) {
      const message =
        e instanceof ApiRequestError ? e.message : "Could not load portfolio performance.";
      setError(message);
      setComputed(null);
      setSnapshots(null);
    } finally {
      setLoading(false);
    }
  }, [userId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const series = useMemo(
    () => buildSeries(snapshots?.points ?? [], computed?.totalPortfolioValueUsd),
    [snapshots?.points, computed?.totalPortfolioValueUsd]
  );

  const chartW = 640;
  const chartH = 200;
  const { line, area } = useMemo(() => chartPath(series, chartW, chartH), [series]);

  const rangePct = useMemo(
    () => rangeChangeLabel(series, computed?.totalPortfolioValueUsd),
    [series, computed?.totalPortfolioValueUsd]
  );

  const pnlUsd = portfolioPnLUsd(computed);
  const pnlNum = Number(pnlUsd);
  const pnlPositive = Number.isFinite(pnlNum) && pnlNum >= 0;

  const recordSnapshotNow = useCallback(async () => {
    setSnapshotSaving(true);
    setSnapshotMessage(null);
    try {
      await createPortfolioSnapshot(userId);
      setSnapshotMessage("Snapshot recorded.");
      await load();
    } catch (e) {
      const message =
        e instanceof ApiRequestError ? e.message : "Could not record portfolio snapshot.";
      setSnapshotMessage(message);
    } finally {
      setSnapshotSaving(false);
    }
  }, [userId, load]);

  return (
    <section className="mt-10" aria-labelledby="portfolio-performance-heading">
      <h2 id="portfolio-performance-heading" className="text-lg font-semibold tracking-tight text-white">
        Trading performance
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Portfolio value uses live market prices when available. History comes from daily snapshots.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void recordSnapshotNow()}
          disabled={snapshotSaving}
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {snapshotSaving ? "Recording…" : "Record snapshot now"}
        </button>
        {snapshotMessage ? (
          <p className="text-xs text-slate-400" role="status">
            {snapshotMessage}
          </p>
        ) : null}
      </div>

      {error ? (
        <div
          className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-12">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20 lg:col-span-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Profit / loss</p>
          <p
            className={`mt-2 text-2xl font-bold tabular-nums ${
              pnlPositive ? "text-emerald-400" : "text-rose-300"
            }`}
          >
            {loading ? "…" : formatUsd(pnlUsd)}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Versus total acquisition cost across{" "}
            <span className="text-slate-400">{computed?.cardInstanceCount ?? "—"}</span> owned cards.
          </p>
          <div className="mt-5 h-px bg-white/10" />
          <dl className="mt-4 space-y-2 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Cost basis</dt>
              <dd className="font-medium text-slate-200 tabular-nums">
                {loading ? "…" : formatUsd(computed?.totalAcquisitionCostUsd)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Market value</dt>
              <dd className="font-medium text-slate-200 tabular-nums">
                {loading ? "…" : formatUsd(computed?.totalPortfolioValueUsd)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20 lg:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Account balance</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums text-white md:text-3xl">
                  {loading ? "…" : formatUsd(computed?.totalPortfolioValueUsd)}
                </span>
                {rangePct != null ? (
                  <span
                    className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${
                      rangePct >= 0
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-rose-500/20 text-rose-200"
                    }`}
                  >
                    {formatPct(rangePct)}
                  </span>
                ) : (
                  <span className="rounded-lg bg-white/10 px-2 py-0.5 text-xs text-slate-400">—</span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Change in selected range (snapshots + current live value).
              </p>
            </div>
            <div className="flex rounded-xl border border-white/10 bg-slate-950/60 p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRange(r.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    range === r.id
                      ? "bg-white/15 text-accent shadow-accent-glow"
                      : "text-slate-400 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative mt-6 overflow-hidden rounded-xl border border-white/5 bg-slate-950/50">
            {loading ? (
              <div className="flex h-[200px] items-center justify-center text-sm text-slate-500">Loading chart…</div>
            ) : series.length === 0 ? (
              <div className="flex h-[200px] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-slate-500">
                <p>No snapshots in this range yet.</p>
                <p className="text-xs text-slate-600">
                  The server records one row per user on a schedule (daily by default). You can also POST{" "}
                  <code className="rounded bg-white/10 px-1">/portfolio/snapshot</code> to add a point.
                </p>
              </div>
            ) : (
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="h-[200px] w-full"
                preserveAspectRatio="none"
                role="img"
                aria-label="Portfolio value over time"
              >
                <defs>
                  <linearGradient id="pvFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {area ? <path d={area} fill="url(#pvFill)" /> : null}
                {line ? (
                  <path
                    d={line}
                    fill="none"
                    stroke="rgb(52 211 153)"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
