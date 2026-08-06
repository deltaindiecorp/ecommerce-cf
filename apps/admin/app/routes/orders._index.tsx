import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData, Link, Form, useSearchParams } from "@remix-run/react";

import { API_BASE } from "~/lib/config";
function getToken(r: Request) {
  return r.headers.get("Cookie")?.match(/admin_token=([^;]+)/)?.[1] ?? "";
}

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

export async function loader({ request }: LoaderFunctionArgs) {
  const token  = getToken(request);
  const url    = new URL(request.url);
  const page   = url.searchParams.get("page")   ?? "1";
  const status = url.searchParams.get("status") ?? "";

  const params = new URLSearchParams({ page, limit: "20" });
  if (status) params.set("status", status);

  const res  = await fetch(`${API_BASE}/api/admin/orders?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json() as any;

  return json({
    orders:  body.success ? body.data  : [],
    meta:    body.success ? body.meta  : { page: 1, limit: 20, total: 0 },
    status,
  });
}

export default function OrderListPage() {
  const { orders, meta, status } = useLoaderData<typeof loader>();
  const [searchParams]           = useSearchParams();
  const currentPage = Number(searchParams.get("page") ?? 1);
  const totalPages  = Math.ceil(meta.total / meta.limit);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Manajemen Pesanan</h1>
        <p className="text-sm text-gray-400">{meta.total} pesanan total</p>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {["", "pending_payment", "paid", "processing", "packed", "shipped", "delivered", "completed", "cancelled"].map(s => (
          <Link
            key={s}
            to={`/orders${s ? `?status=${s}` : ""}`}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              status === s ? "bg-blue-600 text-white border-blue-600" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {s ? STATUS_LABEL[s] : "Semua"}
          </Link>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">No. Pesanan</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Pembeli</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Total</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Tanggal</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {orders.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">Tidak ada pesanan</td></tr>
            ) : (
              orders.map((order: any) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-800">{order.orderNo}</td>
                  <td className="px-4 py-3 text-gray-700">
                    <p>{order.guestName ?? order.user?.name ?? "—"}</p>
                    <p className="text-xs text-gray-400">{order.guestEmail ?? order.user?.email}</p>
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-800">
                    Rp {order.total?.toLocaleString("id-ID")}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {order.createdAt ? new Date(order.createdAt).toLocaleDateString("id-ID") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[order.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {STATUS_LABEL[order.status] ?? order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/orders/${order.id}`} className="text-blue-600 hover:underline text-xs">Detail →</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {currentPage > 1 && (
            <Link to={`/orders?page=${currentPage - 1}${status ? `&status=${status}` : ""}`}
              className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-100 bg-white">← Prev</Link>
          )}
          <span className="px-4 py-2 text-sm text-gray-500">{currentPage} / {totalPages}</span>
          {currentPage < totalPages && (
            <Link to={`/orders?page=${currentPage + 1}${status ? `&status=${status}` : ""}`}
              className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-100 bg-white">Next →</Link>
          )}
        </div>
      )}
    </div>
  );
}
