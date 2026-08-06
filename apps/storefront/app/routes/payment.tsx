import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { useEffect } from "react";

import { API_BASE } from "~/lib/config";

export async function loader({ request }: LoaderFunctionArgs) {
  const url     = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  if (!orderId) return redirect("/");

  const res  = await fetch(`${API_BASE}/api/payment/${orderId}/status`);
  const body = await res.json() as any;

  const orderRes  = await fetch(`${API_BASE}/api/admin/orders/${orderId}`).catch(() => null);

  return json({
    orderId,
    paymentStatus: body.success ? body.data : null,
  });
}

export default function PaymentPage() {
  const { orderId, paymentStatus } = useLoaderData<typeof loader>();

  // Poll untuk cek status pembayaran tiap 5 detik (jika belum paid)
  useEffect(() => {
    if (paymentStatus?.status === "paid") return;
    const interval = setInterval(async () => {
      const res  = await fetch(`${API_BASE}/api/payment/${orderId}/status`);
      const body = await res.json() as any;
      if (body.data?.status === "paid") {
        window.location.href = `/orders/${orderId}`;
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [orderId, paymentStatus?.status]);

  if (paymentStatus?.status === "paid") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-green-600 mb-2">Pembayaran Berhasil!</h1>
          <p className="text-gray-600 mb-6">Pesanan Anda sedang kami proses.</p>
          <Link to={`/orders/${orderId}`} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-medium">
            Lihat Status Pesanan
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow p-8 max-w-md w-full text-center">
        <div className="text-5xl mb-4">⏳</div>
        <h1 className="text-xl font-bold mb-2">Menunggu Pembayaran</h1>
        <p className="text-gray-600 text-sm mb-6">
          Selesaikan pembayaran Anda. Halaman ini akan otomatis diperbarui setelah pembayaran dikonfirmasi.
        </p>

        <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
          <p className="text-xs text-gray-500 mb-1">Order ID</p>
          <p className="text-sm font-mono font-medium">{orderId}</p>
        </div>

        <div className="flex items-center justify-center gap-2 text-gray-400 text-sm mb-6">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Memeriksa status pembayaran...
        </div>

        <div className="flex gap-3">
          <Link to="/" className="flex-1 border text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">
            Lanjut Belanja
          </Link>
          <Link to={`/track?orderId=${orderId}`} className="flex-1 border text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">
            Cek Status
          </Link>
        </div>
      </div>
    </div>
  );
}
