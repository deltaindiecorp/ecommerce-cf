import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData, Link, Form, useSearchParams } from "@remix-run/react";

import { ORDER_STATUS_LABEL, ORDER_STATUS_COLOR, ORDER_STATUS_FILTERS } from "@repo/shared";

import { apiFetch } from "~/lib/api";


export async function loader({ request }: LoaderFunctionArgs) {
  const url    = new URL(request.url);
  const page   = url.searchParams.get("page")   ?? "1";
  const status = url.searchParams.get("status") ?? "";

  const params = new URLSearchParams({ page, limit: "20" });
  if (status) params.set("status", status);

  const body = await apiFetch<any[]>(request, `/api/admin/orders?${params}`);

  return json({
    orders:  body.data ?? [],
    meta:    body.meta ?? { page: 1, limit: 20, total: 0 },
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
        {ORDER_STATUS_FILTERS.map(s => (
          <Link
            key={s}
            to={`/orders${s ? `?status=${s}` : ""}`}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              status === s ? "bg-blue-600 text-white border-blue-600" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {s ? ORDER_STATUS_LABEL[s] : "Semua"}
          </Link>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[46rem]">
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
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ORDER_STATUS_COLOR[order.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {ORDER_STATUS_LABEL[order.status] ?? order.status}
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
