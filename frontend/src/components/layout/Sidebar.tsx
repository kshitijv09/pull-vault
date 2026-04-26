"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Gavel, Home, LayoutGrid, Store, Trophy } from "lucide-react";

function PokeballIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path
        d="M12 3a9 9 0 0 1 0 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.35"
      />
    </svg>
  );
}

type NavItem = {
  href: string;
  label: string;
  icon: "home" | "trophy" | "pokeball" | "grid" | "store" | "analytics" | "auctions";
  match: (pathname: string) => boolean;
};

const items: NavItem[] = [
  {
    href: "/",
    label: "Home",
    icon: "home",
    match: (p) => p === "/"
  },
  {
    href: "/drop-sale",
    label: "Drop Sale",
    icon: "trophy",
    match: (p) => p.startsWith("/drop-sale")
  },

  {
    href: "/collection",
    label: "Collection",
    icon: "grid",
    match: (p) => p.startsWith("/collection")
  },
  {
    href: "/marketplace",
    label: "Marketplace",
    icon: "store",
    match: (p) => p.startsWith("/marketplace")
  },
  {
    href: "/auctions",
    label: "Auctions",
    icon: "auctions",
    match: (p) => p.startsWith("/auctions")
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: "analytics",
    match: (p) => p.startsWith("/analytics")
  }
];

function Icon({ kind }: { kind: NavItem["icon"] }) {
  const cls = "h-5 w-5";
  if (kind === "home") {
    return <Home className={cls} aria-hidden />;
  }

  if (kind === "trophy") {
    return <Trophy className={cls} aria-hidden />;
  }

  if (kind === "grid") {
    return <LayoutGrid className={cls} aria-hidden />;
  }

  if (kind === "store") {
    return <Store className={cls} aria-hidden />;
  }

  if (kind === "analytics") {
    return <BarChart3 className={cls} aria-hidden />;
  }

  if (kind === "auctions") {
    return <Gavel className={cls} aria-hidden />;
  }

  return <PokeballIcon className={cls} />;
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[240px] shrink-0 border-r border-white/5 bg-surface-sidebar/80 backdrop-blur-xl md:block">
      <div className="flex h-full flex-col gap-2 px-4 py-8">
        <div className="px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Browse
        </div>
        <nav className="flex flex-col gap-2">
          {items.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 rounded-2xl px-3 py-3 transition ${
                  active ? "bg-white/5" : "hover:bg-white/5"
                }`}
              >
                <span
                  className={`grid h-11 w-11 place-items-center rounded-2xl border text-white transition ${
                    active
                      ? "border-accent/35 bg-white/10 text-accent shadow-accent-glow"
                      : "border-white/10 bg-white/5 text-slate-200 group-hover:border-white/15"
                  }`}
                >
                  <Icon kind={item.icon} />
                </span>
                <span
                  className={`text-sm font-semibold ${
                    active ? "text-accent" : "text-slate-300 group-hover:text-slate-100"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
