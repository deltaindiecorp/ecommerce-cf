import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, Link, useNavigation, useSearchParams } from "@remix-run/react";

import { apiFetch, formatApiError } from "~/lib/api";

function optText(fd: FormData, key: string): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : v;
}

const FIELD = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const LABEL = "block text-xs font-medium text-gray-500 mb-1";

function warehousePayload(fd: FormData) {
  return {
    name:             String(fd.get("name") ?? ""),
    code:             String(fd.get("code") ?? "").toUpperCase(),
    address:          String(fd.get("address") ?? ""),
    city:             String(fd.get("city") ?? ""),
    province:         String(fd.get("province") ?? ""),
    postalCode:       String(fd.get("postalCode") ?? ""),
    rajaongkirCityId: Number(fd.get("rajaongkirCityId") ?? 0),
    phone:            optText(fd, "phone"),
    picName:          optText(fd, "picName"),
    priority:         Number(fd.get("priority") || 1),
    isActive:         fd.get("isActive") === "on",
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  const selectedId = url.searchParams.get("gudang") ?? "";
  const cityQuery  = url.searchParams.get("kota")   ?? "";

  const warehousesBody = await apiFetch<any[]>(request, "/api/warehouse");

  // Inventaris diambil di loader, bukan fetch dari browser. Versi sebelumnya
  // memanggil /api-proxy/... yang tidak pernah ada — 404, error ditelan catch,
  // dan tabelnya selalu tampil kosong seolah gudangnya memang tidak berisi.
  let inventory: any[] = [];
  if (selectedId) {
    const invBody = await apiFetch<any[]>(request, `/api/warehouse/${selectedId}/inventory`);
    inventory = invBody.success ? invBody.data ?? [] : [];
  }

  // Pencarian kota RajaOngkir untuk mengisi rajaongkirCityId tanpa hafalan.
  // Butuh RAJAONGKIR_API_KEY aktif; kalau kosong hasilnya sekadar daftar kosong.
  let cities: any[] = [];
  if (cityQuery.trim().length >= 2) {
    // Pencarian kota bergantung pada RajaOngkir; kegagalannya tidak boleh
    // menjatuhkan seluruh halaman gudang, jadi ditangkap di sini.
    const cityBody = await apiFetch<any[]>(
      request, `/api/shipping/cities?search=${encodeURIComponent(cityQuery)}`,
    ).catch(() => ({ success: false, data: [] as any[] }));
    cities = cityBody.success ? cityBody.data ?? [] : [];
  }

  return json({
    warehouses: warehousesBody.data ?? [],
    inventory,
    selectedId,
    cityQuery,
    cities,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent   = String(formData.get("intent") ?? "");

  if (intent === "create_warehouse") {
    const result = await apiFetch(request, "/api/warehouse", {
      method: "POST", body: JSON.stringify(warehousePayload(formData)),
    });
    if (!result.success) return json({ error: result.error, scope: "warehouse" }, { status: 400 });
    return redirect("/warehouse");
  }

  if (intent === "update_warehouse") {
    const id     = String(formData.get("warehouseId") ?? "");
    const result = await apiFetch(request, `/api/warehouse/${id}`, {
      method: "PATCH", body: JSON.stringify(warehousePayload(formData)),
    });
    if (!result.success) return json({ error: result.error, scope: "warehouse" }, { status: 400 });
    return redirect("/warehouse");
  }

  if (intent === "deactivate_warehouse") {
    const id     = String(formData.get("warehouseId") ?? "");
    const result = await apiFetch(request, `/api/warehouse/${id}`, { method: "DELETE" });
    // API menolak kalau masih ada stok tersisa — pesannya ditampilkan apa adanya
    if (!result.success) return json({ error: result.error, scope: "warehouse" }, { status: 400 });
    return redirect("/warehouse");
  }

  if (intent === "transfer") {
    const payload = {
      fromWarehouse: formData.get("fromWarehouse"),
      toWarehouse:   formData.get("toWarehouse"),
      productId:     formData.get("productId"),
      variantId:     formData.get("variantId") || undefined,
      qty:           Number(formData.get("qty")),
      note:          formData.get("note") || undefined,
    };
    const result = await apiFetch(request, "/api/warehouse/transfer", {
      method: "POST", body: JSON.stringify(payload),
    });
    if (!result.success) return json({ error: result.error, scope: "transfer" }, { status: 400 });
    return redirect("/warehouse");
  }

  if (intent === "complete_transfer") {
    const transferId = String(formData.get("transferId") ?? "");
    const result = await apiFetch(request, `/api/warehouse/transfer/${transferId}/complete`, {
      method: "PATCH",
    });
    if (!result.success) return json({ error: result.error, scope: "warehouse" }, { status: 400 });
    return redirect("/warehouse");
  }

  return json({ error: "Intent tidak dikenal", scope: "warehouse" }, { status: 400 });
}

function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <pre className="mb-4 text-xs bg-red-50 text-red-700 border border-red-100 rounded-lg px-4 py-2.5 whitespace-pre-wrap">
      {formatApiError(error)}
    </pre>
  );
}

// Form isian gudang dipakai dua kali — tambah dan edit. Dipisah supaya keduanya
// tidak bisa melenceng: kolom yang ditambahkan di sini otomatis ada di dua-duanya.
function WarehouseFields({ wh }: { wh?: any }) {
  return (
    <>
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-5">
          <label className={LABEL}>Nama Gudang</label>
          <input name="name" required defaultValue={wh?.name ?? ""} placeholder="Gudang Jakarta" className={FIELD} />
        </div>
        <div className="col-span-2">
          <label className={LABEL}>Kode</label>
          <input name="code" required defaultValue={wh?.code ?? ""} placeholder="JKT"
            className={`${FIELD} font-mono uppercase`} />
        </div>
        <div className="col-span-3">
          <label className={LABEL}>Nama PIC</label>
          <input name="picName" defaultValue={wh?.picName ?? ""} className={FIELD} />
        </div>
        <div className="col-span-2">
          <label className={LABEL}>Telepon</label>
          <input name="phone" defaultValue={wh?.phone ?? ""} className={FIELD} />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12">
          <label className={LABEL}>Alamat</label>
          <input name="address" required defaultValue={wh?.address ?? ""} className={FIELD} />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-3">
          <label className={LABEL}>Kota</label>
          <input name="city" required defaultValue={wh?.city ?? ""} className={FIELD} />
        </div>
        <div className="col-span-3">
          <label className={LABEL}>Provinsi</label>
          <input name="province" required defaultValue={wh?.province ?? ""} className={FIELD} />
        </div>
        <div className="col-span-2">
          <label className={LABEL}>Kode Pos</label>
          <input name="postalCode" required defaultValue={wh?.postalCode ?? ""} placeholder="12345" className={FIELD} />
        </div>
        <div className="col-span-2">
          <label className={LABEL}>ID Kota RajaOngkir</label>
          <input name="rajaongkirCityId" type="number" min={1} required
            defaultValue={wh?.rajaongkirCityId ?? ""} className={FIELD} />
        </div>
        <div className="col-span-2">
          <label className={LABEL}>Prioritas</label>
          <input name="priority" type="number" min={1} defaultValue={wh?.priority ?? 1} className={FIELD} />
          <p className="text-[11px] text-gray-400 mt-1">1 = paling diutamakan</p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="isActive" defaultChecked={wh ? Boolean(wh.isActive) : true}
          className="rounded border-gray-300" />
        Aktif — boleh dipakai memenuhi pesanan
      </label>
    </>
  );
}

export default function WarehousePage() {
  const { warehouses, inventory, selectedId, cityQuery, cities } = useLoaderData<typeof loader>();
  const actionData     = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const nav            = useNavigation();
  const isSubmitting   = nav.state === "submitting";

  const editId   = searchParams.get("edit") ?? "";
  const editing  = warehouses.find((w: any) => w.id === editId);
  const selected = warehouses.find((w: any) => w.id === selectedId);

  const whError       = actionData?.scope === "warehouse" ? actionData.error : null;
  const transferError = actionData?.scope === "transfer"  ? actionData.error : null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Manajemen Gudang</h1>

      <ErrorNote error={whError} />

      {/* Daftar gudang */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {warehouses.length === 0 ? (
          <p className="col-span-3 text-sm text-gray-400 bg-white rounded-xl p-6 shadow-sm">
            Belum ada gudang. Tambahkan minimal satu — tanpa gudang aktif, checkout akan menolak semua pesanan.
          </p>
        ) : (
          warehouses.map((wh: any) => (
            <div
              key={wh.id}
              className={`bg-white rounded-xl shadow-sm p-5 ${selectedId === wh.id ? "ring-2 ring-blue-600" : ""} ${wh.isActive ? "" : "opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-gray-800">{wh.name}</p>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                  wh.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                }`}>
                  {wh.isActive ? "Aktif" : "Nonaktif"}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">{wh.city} · Prioritas {wh.priority}</p>
              <p className="text-xs text-gray-400 font-mono mt-0.5">{wh.code}</p>

              <div className="flex items-center gap-3 mt-3 text-xs">
                <Link to={`/warehouse?gudang=${wh.id}`} className="text-blue-600 hover:underline">Lihat stok</Link>
                <Link to={`/warehouse?edit=${wh.id}`} className="text-gray-600 hover:underline">Edit</Link>
                {wh.isActive && (
                  <Form method="post" className="inline">
                    <input type="hidden" name="intent" value="deactivate_warehouse" />
                    <input type="hidden" name="warehouseId" value={wh.id} />
                    <button type="submit" className="text-red-500 hover:underline">Nonaktifkan</button>
                  </Form>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit gudang */}
      {editing && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-blue-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700">Edit Gudang · {editing.name}</h2>
            <Link to="/warehouse" className="text-xs text-gray-400 hover:text-gray-600">Tutup</Link>
          </div>
          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="update_warehouse" />
            <input type="hidden" name="warehouseId" value={editing.id} />
            <WarehouseFields wh={editing} />
            <div className="pt-1">
              <button type="submit" disabled={isSubmitting}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* Inventaris gudang terpilih */}
      {selected && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-700">Inventaris · {selected.name}</h2>
            <Link to="/warehouse" className="text-xs text-gray-400 hover:text-gray-600">Tutup</Link>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-gray-600 font-semibold">Produk</th>
                <th className="text-right px-4 py-3 text-gray-600 font-semibold">Bisa Dijual</th>
                <th className="text-right px-4 py-3 text-gray-600 font-semibold">Dipesan</th>
                <th className="text-right px-4 py-3 text-gray-600 font-semibold">Stok Fisik</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {inventory.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-8 text-gray-400">Belum ada stok di gudang ini</td></tr>
              ) : (
                inventory.map((inv: any) => {
                  const sellable = inv.qtyAvailable - inv.qtyReserved;
                  const low      = sellable <= (inv.lowStockAlert ?? 5);
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800">
                        <p>{inv.product?.name ?? inv.productId}</p>
                        {inv.variantId && <p className="text-xs text-gray-400 font-mono">{inv.variantId}</p>}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${low ? "text-red-500" : "text-green-600"}`}>
                        {sellable}
                        {low && <span className="ml-1 text-[10px] font-normal">menipis</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">{inv.qtyReserved}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{inv.qtyOnHand}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tambah gudang */}
      {!editing && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="font-semibold text-gray-700 mb-4">Tambah Gudang</h2>

          {/* Pencarian ID kota — supaya rajaongkirCityId tidak perlu dihafal */}
          <Form method="get" className="flex items-end gap-3 mb-4 pb-4 border-b border-gray-100">
            <div className="flex-1 max-w-sm">
              <label className={LABEL}>Cari ID Kota RajaOngkir</label>
              <input name="kota" defaultValue={cityQuery} placeholder="ketik nama kota, min. 2 huruf" className={FIELD} />
            </div>
            <button type="submit" className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm">
              Cari
            </button>
            {cityQuery && (
              <span className="text-xs text-gray-400 pb-2">
                {cities.length > 0
                  ? `${cities.length} hasil`
                  : "Tidak ada hasil — pastikan RAJAONGKIR_API_KEY sudah diisi."}
              </span>
            )}
          </Form>

          {cities.length > 0 && (
            <div className="mb-4 max-h-40 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
              {cities.map((city: any) => (
                <div key={city.cityId} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="text-gray-700">{city.type} {city.cityName}, {city.province}</span>
                  <span className="font-mono text-gray-500">ID {city.cityId}</span>
                </div>
              ))}
            </div>
          )}

          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="create_warehouse" />
            <WarehouseFields />
            <div className="pt-1">
              <button type="submit" disabled={isSubmitting}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {isSubmitting ? "Menyimpan..." : "Tambah Gudang"}
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* Transfer stok */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="font-semibold text-gray-700 mb-4">Transfer Stok Antar Gudang</h2>
        <ErrorNote error={transferError} />
        <Form method="post" className="grid grid-cols-2 gap-4">
          <input type="hidden" name="intent" value="transfer" />
          <div>
            <label className={LABEL}>Dari Gudang</label>
            <select name="fromWarehouse" required className={FIELD}>
              <option value="">Pilih gudang asal</option>
              {warehouses.map((wh: any) => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Ke Gudang</label>
            <select name="toWarehouse" required className={FIELD}>
              <option value="">Pilih gudang tujuan</option>
              {warehouses.map((wh: any) => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Product ID</label>
            <input name="productId" required placeholder="UUID produk" className={FIELD} />
          </div>
          <div>
            <label className={LABEL}>Jumlah</label>
            <input name="qty" type="number" min={1} required className={FIELD} />
          </div>
          <div className="col-span-2">
            <label className={LABEL}>Catatan (opsional)</label>
            <input name="note" placeholder="Alasan transfer..." className={FIELD} />
          </div>
          <div className="col-span-2">
            <button type="submit" disabled={isSubmitting}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {isSubmitting ? "Memproses..." : "Buat Transfer"}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
