"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiRequestError, apiPostJson, type LoginResponse } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { AuthPanel } from "@/components/auth/AuthPanel";

export function LoginForm({ title, subtitle }: { title: string; subtitle: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuth();

  const registered = useMemo(() => searchParams.get("registered") === "1", [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const data = await apiPostJson<LoginResponse>("/users/login", { email, password });
      setAuth({ token: data.token, user: data.user });
      router.push("/");
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Something went wrong.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPanel title={title} subtitle={subtitle}>
      {registered ? (
        <div className="mb-6 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-3 text-sm text-slate-100">
          Account created. You can sign in now.
        </div>
      ) : null}

      <form className="space-y-5" onSubmit={onSubmit}>
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            required
            className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none ring-0 transition placeholder:text-slate-600 focus:border-accent/40 focus:shadow-accent-glow"
            placeholder="you@example.com"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            type="password"
            required
            className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40 focus:shadow-accent-glow"
            placeholder="••••••••"
          />
        </label>

        {error ? (
          <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-2xl bg-gradient-to-r from-accent to-accent-deep px-4 py-3 text-sm font-semibold text-white shadow-accent-glow transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-slate-400">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </AuthPanel>
  );
}
