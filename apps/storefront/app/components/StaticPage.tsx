import { SiteHeader } from "~/components/SiteHeader";
import { SiteFooter } from "~/components/SiteFooter";
import { MobileBottomNav } from "~/components/MobileBottomNav";

export function StaticPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-16 md:pb-0">
      <SiteHeader />
      <main className="flex-1 max-w-3xl mx-auto px-4 py-10 w-full">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">{title}</h1>
        <div className="bg-white rounded-xl shadow-sm p-6 md:p-8 space-y-4 text-sm text-gray-600 leading-relaxed">
          {children}
        </div>
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
