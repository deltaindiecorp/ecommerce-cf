import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData, Link, useRevalidator } from "@remix-run/react";
import { useEffect, useRef } from "react";
import type { AdminStatsOverview } from "@repo/shared";

import { toCsv, ORDER_STATUS_LABEL, ORDER_STATUS_COLOR } from "@repo/shared";

import { apiFetch } from "~/lib/api";

export async function loader({ request }: LoaderFunctionArgs) {
  // apiFetch melempar kalau API tak terjangkau dan mengarahkan ke /login kalau
  // sesi habis. Sebelumnya kedua kondisi itu jatuh ke `success: false` lalu
  // di-render sebagai Rp 0 — pemilik toko melihat "tidak ada penjualan" padahal
  // masalahnya koneksi atau token.
  const [statsBody, ordersBody] = await Promise.all([
    apiFetch<AdminStatsOverview>(request, "/api/admin/stats/overview"),
    apiFetch<any[]>(request, "/api/admin/orders?limit=8"),
  ]);

  const lastUpdated = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short",
  });

  return json({
    stats:        (statsBody.success ? statsBody.data : null) as AdminStatsOverview | null,
    recentOrders: ordersBody.data ?? [],
    total:        ordersBody.meta?.total ?? 0,
    lastUpdated,
  });
}



function initials(name?: string | null): string {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
}

function TrendBadge({ pct }: { pct: number }) {
  const isUp = pct >= 0;
  return (
    <span className={`text-xs font-medium px-2 py-1 rounded-full flex items-center gap-1 ${isUp ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
      <span>{isUp ? "↑" : "↓"}</span>
      {Math.abs(pct)}%
    </span>
  );
}

function exportOrdersCsv(orders: any[]) {
  const header = ["No. Pesanan", "Pelanggan", "Tanggal", "Status", "Total"];
  const rows = orders.map(o => [
    o.orderNo,
    o.guestName ?? o.user?.name ?? "Customer",
    o.createdAt ? new Date(o.createdAt).toLocaleString("id-ID") : "",
    ORDER_STATUS_LABEL[o.status] ?? o.status,
    o.total,
  ]);
  // toCsv menetralkan sel yang diawali =, +, -, @ — nama pembeli berasal dari
  // guest checkout yang tidak terautentikasi dan bisa berisi formula.
  const csv = toCsv([header, ...rows]);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `pesanan-terbaru-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Dashboard dibiarkan terbuka berjam-jam di layar toko. Tanpa penyegaran, yang
// tampil adalah angka saat halaman dibuka — berlabel jam yang juga ikut basi,
// jadi tidak ada petunjuk bahwa datanya sudah usang.
const REFRESH_MS = 60_000;

function useAutoRevalidate(intervalMs: number) {
  const revalidator = useRevalidator();
  // Disimpan di ref supaya interval tidak dibuat ulang tiap render — identitas
  // revalidator berubah setiap kali statusnya berganti.
  const revalidate = useRef(revalidator.revalidate);
  revalidate.current = revalidator.revalidate;

  useEffect(() => {
    const tick = () => {
      // Tab tersembunyi tidak perlu ditarik datanya; percuma dan boros.
      if (document.visibilityState === "visible") revalidate.current();
    };

    const id = setInterval(tick, intervalMs);
    // Kembali ke tab setelah lama ditinggal adalah momen paling mungkin
    // angkanya basi — segarkan segera, jangan tunggu tick berikutnya.
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs]);

  return revalidator.state !== "idle";
}

export default function DashboardPage() {
  const { stats, recentOrders, total, lastUpdated } = useLoaderData<typeof loader>();
  const refreshing = useAutoRevalidate(REFRESH_MS);

  const maxRevenue = Math.max(1, ...(stats?.weeklyRevenue.map(d => d.revenue) ?? [1]));

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 mb-1">Overview</h1>
          <p className="text-sm text-gray-500">Ringkasan performa toko Anda hari ini.</p>
        </div>
        <span className="text-xs font-medium text-gray-500 bg-white px-3 py-1.5 rounded-full border border-gray-200 w-max flex items-center gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full ${refreshing ? "bg-blue-500 animate-pulse" : "bg-green-500"}`}
            aria-hidden="true"
          />
          {refreshing ? "Memperbarui..." : `Update Terakhir: ${lastUpdated} WIB`}
        </span>
      </header>

      {/* Stat Cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-lg">💰</div>
            {stats && <TrendBadge pct={stats.totalSalesTrendPct} />}
          </div>
          <p className="text-sm text-gray-400 mb-1">Total Penjualan (Hari Ini)</p>
          <p className="text-2xl font-bold text-gray-800">Rp {(stats?.totalSalesToday ?? 0).toLocaleString("id-ID")}</p>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-3">
            <div className="w-10 h-10 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center text-lg">🛍️</div>
            {stats && <TrendBadge pct={stats.newOrdersTrendPct} />}
          </div>
          <p className="text-sm text-gray-400 mb-1">Pesanan Baru (Hari Ini)</p>
          <p className="text-2xl font-bold text-gray-800">{stats?.newOrdersToday ?? 0}</p>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-3">
            <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-lg">🧑‍🤝‍🧑</div>
            {stats && <TrendBadge pct={stats.newCustomersTrendPct} />}
          </div>
          <p className="text-sm text-gray-400 mb-1">Pelanggan Baru (Hari Ini)</p>
          <p className="text-2xl font-bold text-gray-800">{stats?.newCustomersToday ?? 0}</p>
        </div>

        {/* Laba kotor — dihitung dari costSnapshot per item order, jadi memakai
            harga modal SAAT transaksi, bukan modal hari ini. Tidak termasuk ongkir. */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-lg">📈</div>
            {stats && <TrendBadge pct={stats.grossProfitTrendPct} />}
          </div>
          <p className="text-sm text-gray-400 mb-1">Laba Kotor (Hari Ini)</p>
          <p className="text-2xl font-bold text-gray-800">Rp {(stats?.grossProfitToday ?? 0).toLocaleString("id-ID")}</p>
          {stats && stats.profitCoveragePct < 100 && (
            <p className="text-[11px] text-orange-600 mt-1.5">
              Baru {stats.profitCoveragePct}% unit terjual yang harga modalnya terisi —
              laba sebenarnya lebih rendah dari angka ini.
            </p>
          )}
        </div>
      </section>

      {/* Revenue Chart */}
      <section className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="font-semibold text-gray-700 mb-4">Pendapatan 7 Hari Terakhir</h3>
        <div className="h-56 flex items-end justify-between gap-2 border-b border-l border-gray-100 pt-6 pb-2 pl-2">
          {(stats?.weeklyRevenue ?? []).map((d) => {
            const heightPct = Math.max(2, (d.revenue / maxRevenue) * 100);
            return (
              <div key={d.date} className="flex-1 h-full flex flex-col justify-end items-center group relative">
                {d.revenue > 0 && (
                  <div className="absolute -top-1 -translate-y-full bg-gray-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    Rp {d.revenue.toLocaleString("id-ID")}
                  </div>
                )}
                <div
                  className="w-full max-w-10 bg-blue-200 group-hover:bg-blue-600 rounded-t transition-colors cursor-default"
                  style={{ height: `${heightPct}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between px-2 pt-2 text-xs text-gray-400">
          {(stats?.weeklyRevenue ?? []).map(d => <span key={d.date}>{d.label}</span>)}
        </div>
      </section>

      {/* Recent Orders */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-700">Pesanan Terbaru</h2>
            <p className="text-xs text-gray-400">{total} pesanan total</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Tombol ini hanya mengekspor pesanan yang sudah dimuat di kartu
                ini, bukan seluruh {total}. Labelnya menyebut jumlahnya supaya
                tidak disangka ekspor penuh — letaknya persis di sebelah angka
                total. */}
            <button
              type="button"
              onClick={() => exportOrdersCsv(recentOrders)}
              disabled={recentOrders.length === 0}
              title="Mengekspor pesanan yang tampil di kartu ini saja"
              className="text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg disabled:opacity-40 transition-colors"
            >
              ⬇️ Export {recentOrders.length} Terbaru
            </button>
            <Link to="/orders" className="text-blue-600 text-sm hover:underline">Lihat semua →</Link>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {recentOrders.length === 0 ? (
            <p className="text-center text-gray-400 py-8">Belum ada pesanan</p>
          ) : (
            recentOrders.slice(0, 5).map((order: any) => {
              const name = order.guestName ?? order.user?.name ?? "Customer";
              return (
                <Link key={order.id} to={`/orders/${order.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-[11px] shrink-0">
                    {initials(name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 text-sm truncate">{order.orderNo}</p>
                    <p className="text-xs text-gray-400 truncate">{name}</p>
                  </div>
                  <p className="text-sm font-semibold text-gray-800 shrink-0">
                    Rp {order.total?.toLocaleString("id-ID")}
                  </p>
                  <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${ORDER_STATUS_COLOR[order.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {ORDER_STATUS_LABEL[order.status] ?? order.status}
                  </span>
                </Link>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
