import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";

import { API_BASE } from "~/lib/config";

function getToken(request: Request) {
  return request.headers.get("Cookie")?.match(/admin_token=([^;]+)/)?.[1] ?? "";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const token = getToken(request);
  const res   = await fetch(`${API_BASE}/api/admin/orders?limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json() as any;

  return json({
    recentOrders: body.success ? body.data : [],
    total:        body.meta?.total ?? 0,
  });
}

const STATUS_COLOR: Record<string, string> = {
  pending_payment: "bg-yellow-100 text-yellow-700",
  paid:            "bg-green-100 text-green-700",
  processing:      "bg-blue-100 text-blue-700",
  packed:          "bg-purple-100 text-purple-700",
  shipped:         "bg-indigo-100 text-indigo-700",
  delivered:       "bg-teal-100 text-teal-700",
  completed:       "bg-gray-100 text-gray-700",
  cancelled:       "bg-red-100 text-red-700",
  refunded:        "bg-orange-100 text-orange-700",
};

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Menunggu Bayar",
  paid:            "Lunas",
  processing:      "Diproses",
  packed:          "Dikemas",
  shipped:         "Dikirim",
  delivered:       "Diterima",
  completed:       "Selesai",
  cancelled:       "Batal",
  refunded:        "Refund",
};

export default function DashboardPage() {
  const { recentOrders, total } = useLoaderData<typeof loader>();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-sm text-gray-400">Total: {total} pesanan</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="text-sm text-gray-400 mb-1">Total Pesanan</p>
          <p className="text-2xl font-bold text-gray-800">{total}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="text-sm text-gray-400 mb-1">Pesanan Masuk (Terbaru)</p>
          <p className="text-2xl font-bold text-blue-600">{recentOrders.length}</p>
        </div>
        <Link to="/orders?status=pending_payment" className="bg-yellow-50 rounded-xl shadow-sm p-5 hover:shadow-md transition-shadow">
          <p className="text-sm text-yellow-600 mb-1">Menunggu Pembayaran</p>
          <p className="text-2xl font-bold text-yellow-700">
            {recentOrders.filter((o: any) => o.status === "pending_payment").length}
          </p>
        </Link>
      </div>

      {/* Recent Orders */}
      <div className="bg-white rounded-xl shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-700">Pesanan Terbaru</h2>
          <Link to="/orders" className="text-blue-600 text-sm hover:underline">Lihat semua →</Link>
        </div>
        <div className="divide-y">
          {recentOrders.length === 0 ? (
            <p className="text-center text-gray-400 py-8">Belum ada pesanan</p>
          ) : (
            recentOrders.map((order: any) => (
              <Link key={order.id} to={`/orders/${order.id}`} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                <div className="flex-1">
                  <p className="font-medium text-gray-800 text-sm">{order.orderNo}</p>
                  <p className="text-xs text-gray-400">{order.guestName ?? order.user?.name ?? "Customer"}</p>
                </div>
                <p className="text-sm font-semibold text-gray-800">
                  Rp {order.total?.toLocaleString("id-ID")}
                </p>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[order.status] ?? "bg-gray-100 text-gray-600"}`}>
                  {STATUS_LABEL[order.status] ?? order.status}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
