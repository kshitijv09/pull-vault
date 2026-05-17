"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Loader2, ShieldCheck, XCircle } from "lucide-react";
import {
  ApiRequestError,
  getDropFairnessPoolSnapshot,
  getPackFairnessReveal,
  reportPackFairnessVerifyEvent
} from "@/lib/api";
import type {
  PackFairnessPoolSnapshotResponse,
  PackFairnessRevealResponse
} from "@/lib/fairness/types";
import { verifyPackFairness, type VerifierResult } from "@/lib/fairness/verifier";

type Status = "idle" | "loading" | "verifying" | "done" | "error";

function truncateHex(hex: string, head = 10, tail = 6): string {
  if (!hex) return "";
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

function formatUsd(value: string | undefined): string {
  if (!value) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function StatusBadge({ status }: { status: "pass" | "fail" | "skipped" }) {
  if (status === "pass") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" /> Pass
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-medium text-red-300">
        <XCircle className="h-3.5 w-3.5" /> Fail
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-2.5 py-0.5 text-xs font-medium text-slate-300">
      Skipped
    </span>
  );
}

export default function VerifyPackPage({ params }: { params: { userPackId: string } }) {
  const userPackId = params.userPackId;

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<PackFairnessRevealResponse | null>(null);
  const [snapshot, setSnapshot] = useState<PackFairnessPoolSnapshotResponse | null>(null);
  const [result, setResult] = useState<VerifierResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setStatus("loading");
      setError(null);
      setReveal(null);
      setSnapshot(null);
      setResult(null);
      try {
        const revealData = await getPackFairnessReveal(userPackId);
        if (cancelled) return;
        setReveal(revealData);

        const snapshotData = await getDropFairnessPoolSnapshot(revealData.dropId);
        if (cancelled) return;
        setSnapshot(snapshotData);

        setStatus("verifying");
        const verifyResult = await verifyPackFairness(revealData, snapshotData);
        if (cancelled) return;
        setResult(verifyResult);
        setStatus("done");

        // Beacon to the B5 fairness audit panel. Fire-and-forget; the report
        // helper swallows network errors so an outage in the audit pipeline
        // cannot block the user-visible result.
        const failingCheck =
          !verifyResult.ok
            ? verifyResult.checks.find((c) => c.status === "fail")?.id ?? null
            : null;
        void reportPackFairnessVerifyEvent(userPackId, {
          result: verifyResult.ok ? "pass" : "fail",
          failingCheck
        });
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        if (err instanceof ApiRequestError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Verification failed for an unknown reason.");
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [userPackId]);

  const headline = useMemo(() => {
    if (status === "loading") return "Loading fairness reveal…";
    if (status === "verifying") return "Replaying derivation in your browser…";
    if (status === "error") return "Verification could not run";
    if (status === "done" && result?.ok) return "Verified fair";
    if (status === "done" && result && !result.ok) return "Verification failed";
    return "Provably fair pack verification";
  }, [status, result]);

  const subtitle = useMemo(() => {
    if (status === "done" && result?.ok) {
      return "Every check passed: the server's secret matches its public commitment, the snapshot matches the transcript, and the derivation reproduced your exact cards.";
    }
    if (status === "done" && result && !result.ok) {
      return "One or more checks did not pass. Review the failing rows below for details.";
    }
    if (status === "error" && error) return error;
    return "All cryptographic checks run entirely in your browser using Web Crypto (SHA-256 + HMAC-SHA256).";
  }, [status, result, error]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-10">
      <div className="mb-8 flex items-start gap-4">
        <div className="rounded-2xl bg-white/5 p-3 text-emerald-300">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-widest text-slate-400">
            Fairness verification
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">{headline}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{subtitle}</p>
          <p className="mt-2 break-all text-xs text-slate-500">
            user_pack_id: <span className="font-mono">{userPackId}</span>
          </p>
        </div>
      </div>

      {status === "loading" || status === "verifying" ? (
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          {status === "loading" ? "Fetching reveal + pool snapshot…" : "Recomputing HMAC stream and replaying the pack…"}
        </div>
      ) : null}

      {status === "error" ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
          <p className="font-medium">Could not verify this pack.</p>
          {error ? <p className="mt-1 text-red-100/80">{error}</p> : null}
          <p className="mt-3 text-xs text-red-200/70">
            Common reasons: the pack is not a provably-fair purchase, you do not own it, or the
            reveal payload is incomplete.
          </p>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
              Checks
            </h2>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
              <ul className="divide-y divide-white/5">
                {result.checks.map((check) => (
                  <li key={check.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{check.label}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{check.detail}</p>
                      {check.evidence && (check.status === "fail" || check.status === "pass") ? (
                        <details className="mt-2 text-xs text-slate-400">
                          <summary className="cursor-pointer text-slate-500 hover:text-slate-300">
                            Show evidence
                          </summary>
                          <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-snug text-slate-200">
                            {JSON.stringify(check.evidence, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                    <div className="shrink-0">
                      <StatusBadge status={check.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
              Pack contents replay
            </h2>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
              <table className="min-w-full divide-y divide-white/5 text-sm">
                <thead>
                  <tr className="bg-white/[0.03] text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3">#</th>
                    <th className="px-5 py-3">Card</th>
                    <th className="px-5 py-3">Rarity</th>
                    <th className="px-5 py-3">Market value</th>
                    <th className="px-5 py-3">Verifier vs recorded</th>
                    <th className="px-5 py-3">Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-200">
                  {result.cards.map((card) => (
                    <tr key={card.position}>
                      <td className="px-5 py-3 align-top text-slate-400">{card.position}</td>
                      <td className="px-5 py-3 align-top">
                        <div className="font-medium text-white">{card.name}</div>
                        <div className="break-all font-mono text-[11px] text-slate-500">
                          {card.actualCatalogCardId || "—"}
                        </div>
                      </td>
                      <td className="px-5 py-3 align-top">{card.rarity}</td>
                      <td className="px-5 py-3 align-top">{formatUsd(card.marketValueUsd)}</td>
                      <td className="px-5 py-3 align-top text-xs">
                        <div className="text-slate-400">
                          recorded: <span className="font-mono text-slate-200">{truncateHex(card.expectedCatalogCardId)}</span>
                        </div>
                        <div className="text-slate-400">
                          replayed: <span className="font-mono text-slate-200">{truncateHex(card.actualCatalogCardId)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 align-top">
                        <StatusBadge status={card.match ? "pass" : "fail"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.generated ? (
              <p className="mt-3 text-xs text-slate-500">
                Branch: <span className="font-mono text-slate-300">{result.generated.branch}</span> · Total replayed
                value: <span className="font-mono text-slate-300">{formatUsd(result.generated.totalValueUsd)}</span> ·
                Target pack value: <span className="font-mono text-slate-300">{formatUsd(result.generated.targetPackValueUsd)}</span>
              </p>
            ) : null}
          </section>
        </div>
      ) : null}

      {reveal && snapshot ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
            Inputs used by the verifier
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DataPanel
              title="Phase 1 — commit"
              rows={[
                ["Nonce (session id)", reveal.phase1.nonce],
                ["Client seed", reveal.phase1.clientSeed],
                ["Client seed source", reveal.phase1.clientSeedSource],
                ["Server commitment (SHA-256)", reveal.phase1.serverCommitmentHex]
              ]}
            />
            <DataPanel
              title="Phase 2 — derivation"
              rows={[
                ["Algorithm version", reveal.algorithmVersion],
                ["Server secret (revealed)", reveal.phase2.serverSecretHex],
                ["Pool fingerprint", reveal.phase2.poolFingerprintHex],
                ["Drop id", reveal.dropId],
                ["Pack inventory id", reveal.packInventoryId],
                ["Consumed at", reveal.consumedAt]
              ]}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <p className="text-xs uppercase tracking-wide text-slate-400">Pool snapshot</p>
            <p className="mt-2 text-sm text-slate-200">
              {snapshot.entries.length.toLocaleString()} cards · fingerprint{" "}
              <span className="break-all font-mono text-xs text-slate-300">
                {snapshot.fingerprintHex}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Pinned at {snapshot.createdAt}. The verifier rehashes every (card_id, market_value)
              pair in order and compares against this value.
            </p>
          </div>

          <p className="mt-4 text-xs text-slate-500">
            See{" "}
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-slate-300 underline-offset-4 hover:underline"
            >
              How verification works <ExternalLink className="h-3 w-3" />
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}

function DataPanel({
  title,
  rows
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="border-b border-white/5 bg-white/[0.02] px-5 py-3 text-xs uppercase tracking-wide text-slate-400">
        {title}
      </div>
      <dl className="divide-y divide-white/5 text-sm">
        {rows.map(([key, value]) => (
          <div key={key} className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[160px_minmax(0,1fr)]">
            <dt className="text-slate-400">{key}</dt>
            <dd className="break-all font-mono text-xs text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
