import Link from "next/link";

export function AuthPanel({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-surface-raised/60 p-8 shadow-[0_30px_120px_-60px_rgba(56,189,248,0.35)] backdrop-blur-xl relative">
      <div className="mb-8">
        <Link href="/" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-white transition">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Back
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight text-white">{title}</h1>
        {subtitle ? <p className="mt-2 text-sm leading-relaxed text-slate-400">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}
