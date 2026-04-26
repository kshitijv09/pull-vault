"use client";

import Image from "next/image";
import { CreditCard } from "lucide-react";

export function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-xl">
      <div className="pointer-events-none absolute inset-0 bg-hero-radial" />

      <div className="relative flex flex-col items-center pt-6">
        <div className="relative aspect-square w-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-slate-800/60 to-slate-950 shadow-[0_30px_120px_-40px_rgba(56,189,248,0.55)]">
          <Image
            src="/assets/hero-visual.png"
            alt="Pack preview"
            fill
            priority
            className="object-cover transition-transform duration-700 hover:scale-105"
            sizes="(max-width: 1024px) 100vw, 600px"
          />

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />
        </div>

        <div className="relative -mt-10 flex w-full max-w-md flex-col items-center">
          <div className="relative h-28 w-72">
            <div className="absolute inset-x-6 top-6 h-16 rounded-[999px] bg-black/55 blur-xl" />
            <div className="absolute inset-x-10 top-10 h-10 rounded-[999px] border border-accent/35 bg-gradient-to-b from-slate-900/90 to-slate-950/95 shadow-accent-ring" />
            <div className="absolute inset-x-16 top-[52px] h-3 rounded-full bg-accent/25 blur-md" />
          </div>

          <div className="relative z-10 -mt-16 flex w-full flex-wrap items-center justify-center gap-3 px-4">
            <button
              type="button"
              className="pointer-events-none rounded-2xl border border-white/20 bg-white/10 px-5 py-2 text-sm font-semibold text-white backdrop-blur-md"
            >
              Ship
            </button>
            <button
              type="button"
              className="pointer-events-none inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-accent to-accent-deep px-5 py-2 text-sm font-semibold text-white shadow-accent-glow"
            >
              Sell $13,680.00
              <CreditCard className="h-4 w-4 opacity-90" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
