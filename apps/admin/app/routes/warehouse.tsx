import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, Link, useNavigation } from "@remix-run/react";
import { useState } from "react";

import { API_BASE } from "~/lib/config";
function getToken(r: Request) {
  return r.headers.get("Cookie")?.match(/admin_token=([^;]+)/)?.[1] ?? "";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const token = getToken(request);
  const [warehousesRes] = await Promise.all([
    fetch(`${API_BASE}/api/warehouse`, { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  const warehousesBody = await warehousesRes.json() as any;
  return json({ warehouses: warehousesBody.success ? warehousesBody.data : [] });
}

export async function action({ request }: ActionFunctionArgs) {
  const token    = getToken(request);
  const formData = await request.formData();
  const intent   = formData.get("intent") as string;

  if (intent === "transfer") {
    const payload = {
      fromWarehouse: formData.get("fromWarehouse"),
      toWarehouse:   formData.get("toWarehouse"),
      productId:     formData.get("productId"),
      variantId:     formData.get("variantId") || undefined,
      qty:           Number(formData.get("qty")),
      note:          formData.get("note") || undefined,
    };
    const res  = await fetch(`${API_BASE}/api/warehouse/transfer`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify(payload),
    });
    const result = await res.json() as any;
    if (!result.success) return json({ error: result.error, selectedWarehouse: formData.get("fromWarehouse") }, { status: 400 });
    return redirect("/warehouse");
  }

  if (intent === "complete_transfer") {
    const transferId = formData.get("transferId") as string;
    await fetch(`${API_BASE}/api/warehouse/transfer/${transferId}/complete`, {
      method:  "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
    return redirect("/warehouse");
  }

  return json({ error: "Intent tidak dikenal" }, { status: 400 });
}

export async function inventoryLoader(warehouseId: string, token: string) {
  const res  = await fetch(`${API_BASE}/api/warehouse/${warehouseId}/inventory`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return await res.json() as any;
}

export default function WarehousePage() {
  const { warehouses }         = useLoaderData<typeof loader>();
  const actionData             = useActionData<typeof action>();
  const nav                    = useNavigation();
  const isSubmitting           = nav.state === "submitting";
  const [selectedWh, setSelectedWh] = useState<string>("");
  const [inventory, setInventory]   = useState<any[]>([]);
  const [loadingInv, setLoadingInv] = useState(false);

  async function loadInventory(whId: string) {
    setSelectedWh(whId);
    setLoadingInv(true);
    try {
      const res  = await fetch(`/api-proxy/warehouse/${whId}/inventory`);
      const body = await res.json() as any;
      setInventory(body.data ?? []);
    } catch {
      setInventory([]);
    } finally {
      setLoadingInv(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Manajemen Gudang</h1>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {warehouses.map((wh: any) => (
          <button
            key={wh.id}
            type="button"
            onClick={() => loadInventory(wh.id)}
            className={`bg-white rounded-xl shadow-sm p-5 text-left hover:shadow-md transition-shadow ${selectedWh === wh.id ? "ring-2 ring-blue-600" : ""}`}
          >
            <p className="font-semibold text-gray-800">{wh.name}</p>
            <p className="text-sm text-gray-500">{wh.city} · Prioritas {wh.priority}</p>
            <p className="text-xs text-gray-400 mt-1">{wh.code}</p>
          </button>
        ))}
      </div>

      {selectedWh && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-700">Inventaris Gudang</h2>
            {loadingInv && <span className="text-xs text-gray-400 animate-pulse">Memuat...</span>}
          </div>
          {!loadingInv && (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600 font-semibold">Produk</th>
                  <th className="text-right px-4 py-3 text-gray-600 font-semibold">Tersedia</th>
                  <th className="text-right px-4 py-3 text-gray-600 font-semibold">Dipesan</th>
                  <th className="text-right px-4 py-3 text-gray-600 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {inventory.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-gray-400">Tidak ada data inventaris</td></tr>
                ) : (
                  inventory.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800">
                        <p>{inv.product?.name ?? inv.productId}</p>
                        {inv.variantId && <p className="text-xs text-gray-400">{inv.variantId}</p>}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${inv.qtyAvailable - inv.qtyReserved <= (inv.lowStockThreshold ?? 5) ? "text-red-500" : "text-green-600"}`}>
                        {inv.qtyAvailable - inv.qtyReserved}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">{inv.qtyReserved}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{inv.qtyOnHand}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Transfer stok */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="font-semibold text-gray-700 mb-4">Transfer Stok Antar Gudang</h2>
        <Form method="post" className="grid grid-cols-2 gap-4">
          <input type="hidden" name="intent" value="transfer" />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Dari Gudang</label>
            <select name="fromWarehouse" required className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Pilih gudang asal</option>
              {warehouses.map((wh: any) => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Ke Gudang</label>
            <select name="toWarehouse" required className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Pilih gudang tujuan</option>
              {warehouses.map((wh: any) => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Product ID</label>
            <input name="productId" required placeholder="UUID produk" className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Jumlah</label>
            <input name="qty" type="number" min={1} required className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Catatan (opsional)</label>
            <input name="note" placeholder="Alasan transfer..." className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          {actionData?.error && (
            <p className="col-span-2 text-red-500 text-sm">{actionData.error as string}</p>
          )}
          <div className="col-span-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {isSubmitting ? "Memproses..." : "Buat Transfer"}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
