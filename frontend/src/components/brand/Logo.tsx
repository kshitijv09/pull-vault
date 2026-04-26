import { Layers } from "lucide-react";

type LogoProps = {
  size?: "sm" | "md";
  className?: string;
};

export function Logo({ size = "md", className = "" }: LogoProps) {
  const textClass = size === "sm" ? "text-lg tracking-tight" : "text-2xl tracking-tight";
  const iconClass = size === "sm" ? "h-7 w-7" : "h-9 w-9";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span
        className={`grid place-items-center rounded-xl border border-white/10 bg-white/5 ${iconClass} text-accent shadow-[0_0_24px_-10px_rgba(56,189,248,0.65)] backdrop-blur-md`}
      >
        <Layers className="h-[55%] w-[55%] text-white" aria-hidden />
      </span>
      <span
        className={`${textClass} font-extrabold text-white`}
        style={{ fontFeatureSettings: '"ss01" on' }}
      >
        PullVault
      </span>
    </div>
  );
}
