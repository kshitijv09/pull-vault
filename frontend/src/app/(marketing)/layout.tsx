import { MobileSidebarNav } from "@/components/layout/MobileSidebarNav";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopNav } from "@/components/layout/TopNav";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-h-screen flex-1 flex-col">
          <TopNav />
          <MobileSidebarNav />
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
}
