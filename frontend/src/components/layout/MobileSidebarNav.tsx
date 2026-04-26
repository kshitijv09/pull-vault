"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/drop-sale", label: "Drop Sale" },

  { href: "/collection", label: "Collection" },
  { href: "/marketplace", label: "Market" },
  { href: "/auctions", label: "Auctions" },
  { href: "/analytics", label: "Analytics" }
];

export function MobileSidebarNav() {
  const pathname = usePathname();

  return (
    <div className="border-b border-white/5 bg-surface-sidebar/55 px-4 py-3 backdrop-blur-xl md:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
        {links.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href);

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex-1 rounded-xl px-3 py-2 text-center text-xs font-semibold ${
                active
                  ? "bg-white/10 text-accent shadow-accent-glow"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
