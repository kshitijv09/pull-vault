import Link from "next/link";
import { CreditCard } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { HeroVisual } from "@/components/landing/HeroVisual";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.16),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-hero-radial opacity-90" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-14 lg:max-w-none lg:grid-cols-2 lg:gap-10 lg:px-10 lg:py-16">
        <div className="max-w-xl">
          <div className="mb-6">
            <Logo size="sm" />
          </div>

          <h1 className="text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
            Open Packs. Win Cards.
            <span className="block bg-gradient-to-r from-accent to-accent-deep bg-clip-text text-transparent">
              Cash Out Instantly.
            </span>
          </h1>

          <p className="mt-5 max-w-md text-pretty text-base leading-relaxed text-slate-400">
            Limited drops, live inventory, and real market pricing — built for collectors who want the
            rush without the guesswork.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/marketplace"
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-accent to-accent-deep px-7 py-3 text-base font-semibold text-white shadow-accent-glow transition hover:brightness-110"
            >
              Grab a Pack
              <CreditCard className="h-5 w-5 opacity-95" aria-hidden />
            </Link>
            <Link
              href="/signup"
              className="text-sm font-semibold text-slate-300 underline-offset-4 transition hover:text-white hover:underline"
            >
              Create an account
            </Link>
          </div>
        </div>

        <HeroVisual />
      </div>
    </section>
  );
}
