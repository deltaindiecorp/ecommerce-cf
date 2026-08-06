import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";

import { API_BASE } from "~/lib/config";
import { SiteHeader } from "~/components/SiteHeader";
import { SiteFooter } from "~/components/SiteFooter";
import { MobileBottomNav } from "~/components/MobileBottomNav";
const STATUS_ICON: Record<string, string> = {
  pending_payment: "⏳",
  paid:            "✅",
  processing:      "🔧",
  packed:          "📦",
  shipped:         "🚚",
  delivered:       "📬",
  completed:       "🎉",
  cancelled:       "❌",
  refunded:        "↩️",
};
const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Menunggu Pembayaran",
  paid:            "Pembayaran Diterima",
  processing:      "Sedang Diproses",
  packed:          "Dikemas",
  shipped:         "Dalam Pengiriman",
  delivered:       "Telah Diterima",
  completed:       "Selesai",
  cancelled:       "Dibatalkan",
  refunded:        "Dikembalikan",
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const orderId   = params.id!;
  const token     = request.headers.get("Cookie")?.match(/auth_token=([^;]+)/)?.[1];

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Gunakan public tracking endpoint
  const res  = await fetch(`${API_BASE}/api/shipping/order/${orderId}/track`, { headers });
  const body = await res.json() as any;

  return json({ orderId, order: body.success ? body.data : null, error: body.success ? null : body.error });
}

export default function OrderDetailPage() {
  const { orderId, order, error } = useLoaderData<typeof loader>();

  if (error || !order) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col pb-16 md:pb-0">
        <SiteHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-500 mb-4">Pesanan tidak ditemukan atau akses ditolak.</p>
            <Link to="/track" className="text-blue-600 text-sm">Cek via nomor resi</Link>
          </div>
        </div>
        <SiteFooter />
        <MobileBottomNav />
      </div>
    );
  }

  const statusSteps = ["pending_payment", "paid", "processing", "packed", "shipped", "delivered", "completed"];
  const currentIdx  = statusSteps.indexOf(order.status);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-16 md:pb-0">
      <SiteHeader />
      <div className="flex-1 max-w-2xl mx-auto px-4 py-8 w-full">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">← Beranda</Link>
          <h1 className="text-xl font-bold">Detail Pesanan</h1>
        </div>

        {/* Order Header */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-gray-400 mb-1">Nomor Pesanan</p>
              <p className="font-mono font-semibold text-gray-800">{order.orderNo ?? orderId}</p>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-medium">
                {STATUS_ICON[order.status] ?? "•"} {STATUS_LABEL[order.status] ?? order.status}
              </span>
            </div>
          </div>

          {/* Progress bar */}
          {order.status !== "cancelled" && order.status !== "refunded" && (
            <div className="mt-6">
              <div className="flex justify-between mb-1">
                {statusSteps.slice(0, -1).map((s, i) => (
                  <div
                    key={s}
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                      i <= currentIdx ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-400"
                    }`}
                  >
                    {i < currentIdx ? "✓" : i + 1}
                  </div>
                ))}
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full mt-1 relative">
                <div
                  className="h-1.5 bg-blue-600 rounded-full transition-all"
                  style={{ width: `${Math.max(0, (currentIdx / (statusSteps.length - 2)) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Shipment Tracking */}
        {order.trackingNo && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-4">
            <h2 className="font-semibold mb-3">Info Pengiriman</h2>
            <div className="flex gap-4 text-sm text-gray-600 mb-4">
              <span className="font-medium">{order.courier?.toUpperCase()}</span>
              <span>Resi: <span className="font-mono">{order.trackingNo}</span></span>
            </div>
            {order.tracking?.history?.length > 0 && (
              <div className="relative pl-5 border-l-2 border-blue-100 space-y-4">
                {order.tracking.history.map((h: any, i: number) => (
                  <div key={i} className="relative">
                    <div className="absolute -left-[21px] w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white" />
                    <p className="text-sm font-medium text-gray-800">{h.description}</p>
                    <p className="text-xs text-gray-400">{h.date}{h.location ? ` · ${h.location}` : ""}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Order Items */}
        {order.items?.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-4">
            <h2 className="font-semibold mb-3">Produk yang Dipesan</h2>
            <div className="space-y-3">
              {order.items.map((item: any) => (
                <div key={item.id} className="flex gap-3 items-center">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.productName} className="w-12 h-12 rounded-lg object-cover" />
                  ) : (
                    <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-lg">📦</div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.productName}</p>
                    {item.variantName && <p className="text-xs text-gray-400">{item.variantName}</p>}
                    <p className="text-xs text-gray-500">{item.qty} × Rp {item.priceSnapshot?.toLocaleString("id-ID")}</p>
                  </div>
                  <p className="text-sm font-semibold">Rp {item.subtotal?.toLocaleString("id-ID")}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pricing */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-3">Ringkasan Pembayaran</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal Produk</span>
              <span>Rp {order.subtotal?.toLocaleString("id-ID")}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Ongkos Kirim</span>
              <span>Rp {order.shippingCost?.toLocaleString("id-ID")}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Diskon</span>
                <span>- Rp {order.discount?.toLocaleString("id-ID")}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base pt-2 border-t">
              <span>Total</span>
              <span className="text-blue-600">Rp {order.total?.toLocaleString("id-ID")}</span>
            </div>
          </div>
        </div>
      </div>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
