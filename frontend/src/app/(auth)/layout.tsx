import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-surface">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.14),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-hero-radial opacity-80" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        <Link href="/" className="mb-10 w-fit transition hover:opacity-90">
          <Logo size="md" />
        </Link>
        {children}
      </div>
    </div>
  );
}
