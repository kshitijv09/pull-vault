"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, apiPostJson, type UserProfile } from "@/lib/api";
import { AuthPanel } from "@/components/auth/AuthPanel";

export function SignupForm({ title, subtitle }: { title: string; subtitle: string }) {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await apiPostJson<UserProfile>("/users/signup", {
        fullName,
        email,
        password,
        phone: phone.trim() || undefined,
        city: city.trim() || undefined,
        country: country.trim() || undefined
      });

      router.push("/login?registered=1");
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
      <form className="space-y-5" onSubmit={onSubmit}>
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Full name</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            required
            className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40 focus:shadow-accent-glow"
            placeholder="Ash Ketchum"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            required
            className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40 focus:shadow-accent-glow"
            placeholder="you@example.com"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            type="password"
            required
            minLength={6}
            className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40 focus:shadow-accent-glow"
            placeholder="At least 6 characters"
          />
        </label>

        <div className="grid gap-5 sm:grid-cols-3">
          <label className="block space-y-2 sm:col-span-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Phone</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40 focus:shadow-accent-glow"
              placeholder="Optional"
            />
          </label>
          <label className="block space-y-2 sm:col-span-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">City</span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              autoComplete="address-level2"
              className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40 focus:shadow-accent-glow"
              placeholder="Optional"
            />
          </label>
          <label className="block space-y-2 sm:col-span-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Country</span>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              autoComplete="country-name"
              className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-accent/40 focus:shadow-accent-glow"
              placeholder="Optional"
            />
          </label>
        </div>

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
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-slate-400">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthPanel>
  );
}
