import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, Link, useNavigation } from "@remix-run/react";

import { apiFetch, formatApiError } from "~/lib/api";

const ORDER_STATUSES = [
  "pending_payment", "paid", "processing", "packed",
  "shipped", "delivered", "completed", "cancelled", "refunded",
];
// Sinkron dengan REFUNDABLE_STATUSES di apps/api/src/routes/payment.ts
const REFUNDABLE_STATUSES = ["paid", "processing", "packed", "shipped", "delivered", "completed"];
const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Menunggu Bayar",
  paid:            "Lunas",
  processing:      "Sedang Diproses",
  packed:          "Dikemas",
  shipped:         "Dikirim",
  delivered:       "Telah Diterima",
  completed:       "Selesai",
  cancelled:       "Dibatalkan",
  refunded:        "Refund",
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const body = await apiFetch<any>(request, `/api/admin/orders/${params.id}`);
  if (!body.success) throw new Response("Pesanan tidak ditemukan", { status: 404 });
  return json({ order: body.data });
}

export async function action({ params, request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent   = formData.get("intent") as string;
  const orderId  = params.id!;

  if (intent === "update_status") {
    const status = formData.get("status") as string;
    const note   = formData.get("note") as string;
    const result = await apiFetch(request, `/api/admin/orders/${orderId}/status`, {
      method: "PATCH",
      body:   JSON.stringify({ status, note: note || undefined }),
    });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return redirect(`/orders/${orderId}`);
  }

  if (intent === "refund") {
    const reason = formData.get("reason") as string;
    const result = await apiFetch(request, `/api/payment/${orderId}/refund`, {
      method: "POST",
      body:   JSON.stringify({ reason: reason || undefined }),
    });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return redirect(`/orders/${orderId}`);
  }

  if (intent === "add_shipment") {
    const payload = {
      warehouseId: formData.get("warehouseId") as string,
      courier:     formData.get("courier") as string,
      service:     formData.get("service") as string,
      etd:         formData.get("etd") as string,
      cost:        Number(formData.get("cost")),
      trackingNo:  formData.get("trackingNo") as string || undefined,
    };
    const result = await apiFetch(request, `/api/admin/orders/${orderId}/shipment`, {
      method: "POST",
      body:   JSON.stringify(payload),
    });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return redirect(`/orders/${orderId}`);
  }

  return json({ error: "Intent tidak dikenal" }, { status: 400 });
}

export default function OrderDetailPage() {
  const { order }  = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav        = useNavigation();
  const isSubmitting = nav.state === "submitting";
  const addr       = order.shippingAddress ?? {};

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/orders" className="text-gray-400 hover:text-gray-600 text-sm">← Kembali</Link>
        <h1 className="text-xl font-bold text-gray-800">Pesanan: {order.orderNo}</h1>
        <span className={`ml-auto px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700`}>
          {STATUS_LABEL[order.status] ?? order.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-5">
          {/* Customer info */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-gray-700 mb-3">Info Pembeli</h2>
            <p className="text-sm text-gray-800">{order.guestName ?? order.user?.name ?? "—"}</p>
            <p className="text-sm text-gray-500">{order.guestEmail ?? order.user?.email}</p>
            <p className="text-sm text-gray-500">{order.guestPhone ?? order.user?.phone}</p>
          </div>

          {/* Shipping address */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-gray-700 mb-3">Alamat Pengiriman</h2>
            <p className="text-sm text-gray-800">{addr.name} · {addr.phone}</p>
            <p className="text-sm text-gray-500">{addr.address}</p>
            <p className="text-sm text-gray-500">{addr.district}, {addr.city}, {addr.province} {addr.postalCode}</p>
          </div>

          {/* Items */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-gray-700 mb-3">Item Pesanan</h2>
            <div className="space-y-3">
              {order.items?.map((item: any) => (
                <div key={item.id} className="flex gap-3 text-sm">
                  <div className="flex-1">
                    <p className="font-medium text-gray-800">{item.productName}</p>
                    {item.variantName && <p className="text-xs text-gray-400">{item.variantName}</p>}
                    <p className="text-xs text-gray-500">{item.qty} × Rp {item.priceSnapshot?.toLocaleString("id-ID")}</p>
                  </div>
                  <p className="font-semibold">Rp {item.subtotal?.toLocaleString("id-ID")}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t space-y-1 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span>
                <span>Rp {order.subtotal?.toLocaleString("id-ID")}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Ongkir</span>
                <span>Rp {order.shippingCost?.toLocaleString("id-ID")}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Diskon</span>
                  <span>- Rp {order.discount?.toLocaleString("id-ID")}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-800">
                <span>Total</span>
                <span>Rp {order.total?.toLocaleString("id-ID")}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Update status */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-semibold text-gray-700 mb-3">Update Status</h2>
            <Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="update_status" />
              <select
                name="status"
                defaultValue={order.status}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ORDER_STATUSES.map(s => (
                  <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>
                ))}
              </select>
              <textarea
                name="note"
                placeholder="Catatan admin (opsional)"
                rows={2}
                className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
              />
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {isSubmitting ? "Menyimpan..." : "Update Status"}
              </button>
            </Form>
          </div>

          {/* Shipments */}
          {order.shipments?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h2 className="font-semibold text-gray-700 mb-3">Pengiriman</h2>
              {order.shipments.map((s: any) => (
                <div key={s.id} className="text-sm text-gray-700 space-y-1">
                  <p><span className="font-medium">{s.courier?.toUpperCase()} {s.service}</span> · {s.etd}</p>
                  {s.trackingNo && <p className="font-mono text-xs text-gray-500">Resi: {s.trackingNo}</p>}
                  <p className="text-xs text-gray-400 capitalize">Status: {s.status}</p>
                </div>
              ))}
            </div>
          )}

          {/* Add shipment */}
          {!order.shipments?.length && order.status === "paid" && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h2 className="font-semibold text-gray-700 mb-3">Input Pengiriman</h2>
              <Form method="post" className="space-y-3">
                <input type="hidden" name="intent" value="add_shipment" />
                <input
                  name="warehouseId"
                  placeholder="Warehouse ID"
                  required
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input name="courier"  placeholder="Kurir (jne, jnt...)" required className="border rounded-lg px-3 py-2 text-sm" />
                  <input name="service"  placeholder="Layanan (REG, YES...)" required className="border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input name="etd"  placeholder="Estimasi (2-3 hari)" required className="border rounded-lg px-3 py-2 text-sm" />
                  <input name="cost" type="number" placeholder="Biaya kirim" required className="border rounded-lg px-3 py-2 text-sm" />
                </div>
                <input name="trackingNo" placeholder="No. Resi (opsional)" className="w-full border rounded-lg px-3 py-2 text-sm" />
                {Boolean(actionData?.error) && <p className="text-red-500 text-xs">{formatApiError(actionData?.error)}</p>}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {isSubmitting ? "Menyimpan..." : "Input Pengiriman"}
                </button>
              </Form>
            </div>
          )}

          {/* Payment info */}
          {order.payments?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h2 className="font-semibold text-gray-700 mb-3">Pembayaran</h2>
              {order.payments.map((p: any) => (
                <div key={p.id} className="text-sm text-gray-700 space-y-1">
                  <p className="capitalize">{p.gateway} · {p.method ?? "—"}</p>
                  <p>Rp {p.amount?.toLocaleString("id-ID")}</p>
                  <p className={`text-xs font-medium ${p.status === "paid" ? "text-green-600" : p.status === "failed" || p.status === "expired" ? "text-red-500" : "text-yellow-600"}`}>
                    {p.status}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Refund */}
          {REFUNDABLE_STATUSES.includes(order.status) && (
            <div className="bg-white rounded-xl shadow-sm p-5 border border-red-100">
              <h2 className="font-semibold text-red-600 mb-3">Refund</h2>
              <Form
                method="post"
                className="space-y-3"
                onSubmit={(e) => {
                  if (!confirm(`Yakin refund pesanan ${order.orderNo}? Aksi ini akan memproses refund ke gateway pembayaran.`)) {
                    e.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="intent" value="refund" />
                <textarea
                  name="reason"
                  placeholder="Alasan refund (opsional)"
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-red-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {isSubmitting ? "Memproses..." : "Proses Refund"}
                </button>
              </Form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
