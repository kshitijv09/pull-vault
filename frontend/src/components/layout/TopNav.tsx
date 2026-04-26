"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { useAuth } from "@/context/auth-context";
import { depositWalletFunds, getUserProfile } from "@/lib/api";

export function TopNav() {
  const { user, token, setAuth, clearAuth, isReady } = useAuth();
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const walletContainerRef = useRef<HTMLDivElement | null>(null);

  const displayName = useMemo(() => {
    if (!user) return "";
    return user.fullName.split(" ")[0] ?? user.email;
  }, [user]);

  const balanceLabel = useMemo(() => {
    if (!user) return "";
    const currency = user.currencyCode && user.currencyCode.trim().length > 0 ? user.currencyCode : "USD";
    return `${currency} ${user.balance}`;
  }, [user]);

  async function handleAddToWallet() {
    if (!user || !token) return;
    setWalletError(null);
    setIsSubmitting(true);
    try {
      const updatedUser = await depositWalletFunds(user.id, amount);
      setAuth({ token, user: updatedUser });
      setAmount("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not add money to wallet.";
      setWalletError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function openWalletAndRefreshBalance() {
    if (!user || !token) return;
    setWalletError(null);
    setIsWalletOpen(true);
    setIsBalanceLoading(true);
    try {
      const freshUser = await getUserProfile(user.id);
      setAuth({ token, user: freshUser });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load wallet balance.";
      setWalletError(message);
    } finally {
      setIsBalanceLoading(false);
    }
  }

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!walletContainerRef.current) return;
      if (!walletContainerRef.current.contains(event.target as Node)) {
        setIsWalletOpen(false);
        setWalletError(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-surface/55 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 lg:max-w-none lg:px-10">
        <Link href="/" className="transition hover:opacity-90">
          <Logo size="md" />
        </Link>

        <div className="flex items-center gap-4">
          {isReady && user ? (
            <>
              <span className="hidden text-sm text-slate-300 sm:inline">{displayName}</span>
              <div className="relative" ref={walletContainerRef}>
                <button
                  type="button"
                  onClick={() => {
                    setWalletError(null);
                    if (isWalletOpen) {
                      setIsWalletOpen(false);
                      return;
                    }
                    void openWalletAndRefreshBalance();
                  }}
                  className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
                >
                  Wallet
                </button>
                {isWalletOpen ? (
                  <div className="absolute right-0 top-12 z-30 w-72 rounded-2xl border border-white/10 bg-surface p-4 shadow-2xl">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Current balance</p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      {isBalanceLoading ? "Loading..." : balanceLabel}
                    </p>
                    <label className="mt-4 block text-xs text-slate-300" htmlFor="wallet-amount">
                      Add amount
                    </label>
                    <input
                      id="wallet-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="Enter amount"
                      className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-accent/60"
                    />
                    {walletError ? <p className="mt-2 text-xs text-rose-400">{walletError}</p> : null}
                    <button
                      type="button"
                      onClick={handleAddToWallet}
                      disabled={isSubmitting}
                      className="mt-3 w-full rounded-xl bg-gradient-to-r from-accent to-accent-deep px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting ? "Adding..." : "Add to wallet"}
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => clearAuth()}
                className="text-sm font-semibold text-slate-200 transition hover:text-white"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-semibold text-slate-200 transition hover:text-white"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent-deep px-4 py-2 text-sm font-semibold text-white shadow-accent-glow transition hover:brightness-110"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Create Account
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
