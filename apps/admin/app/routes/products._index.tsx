import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, Link, useNavigation } from "@remix-run/react";

import { apiFetch, apiPublic, formatApiError } from "~/lib/api";
import { isAdminRole, useAdminRole } from "~/lib/session";
import { Pager } from "~/components/Pager";

// Margin kotor per produk. Mengembalikan null kalau modal belum diisi — sengaja
// tidak diperlakukan sebagai 0, karena "modal belum diketahui" dan "margin 100%"
// adalah dua hal yang sangat berbeda buat pemilik toko.
function grossMarginPct(price?: number | null, cost?: number | null): number | null {
  if (cost == null || !price) return null;
  return Math.round(((price - cost) / price) * 100);
}

const STATUS_LABEL: Record<string, string> = { active: "Aktif", draft: "Draft", archived: "Arsip" };
const STATUS_COLOR: Record<string, string> = {
  active:   "bg-green-100 text-green-700",
  draft:    "bg-yellow-100 text-yellow-700",
  archived: "bg-gray-100 text-gray-600",
};

const PAGE_SIZE = 20;

export async function loader({ request }: LoaderFunctionArgs) {
  const page = Number(new URL(request.url).searchParams.get("page") ?? 1);

  const [productsBody, categoriesBody] = await Promise.all([
    apiFetch<any[]>(request, `/api/admin/products?page=${page}&limit=${PAGE_SIZE}`),
    apiPublic<any[]>("/api/catalog/categories"),
  ]);

  return json({
    products:   productsBody.data ?? [],
    meta:       productsBody.meta ?? { page, limit: PAGE_SIZE, total: 0 },
    categories: categoriesBody.data ?? [],
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent   = formData.get("intent") as string;

  if (intent === "create") {
    const payload = {
      categoryId:  formData.get("categoryId") || undefined,
      name:        formData.get("name"),
      slug:        formData.get("slug"),
      sku:         formData.get("sku"),
      description: formData.get("description") || undefined,
      price:       Number(formData.get("price")),
      // Kosong dibiarkan undefined (bukan 0) supaya "belum diisi" tetap bisa
      // dibedakan dari "modalnya memang nol" saat menghitung margin.
      costPrice:   formData.get("costPrice") ? Number(formData.get("costPrice")) : undefined,
      weight:      Number(formData.get("weight") || 0),
      images:      formData.get("imageUrl") ? [String(formData.get("imageUrl"))] : [],
      status:      formData.get("status") || "draft",
    };
    const result = await apiFetch(request, "/api/catalog/products", {
      method: "POST", body: JSON.stringify(payload),
    });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return redirect("/products");
  }

  if (intent === "update_status") {
    const id     = formData.get("id") as string;
    const status = formData.get("status") as string;
    const result = await apiFetch(request, `/api/catalog/products/${id}`, {
      method: "PATCH", body: JSON.stringify({ status }),
    });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return redirect("/products");
  }

  if (intent === "archive") {
    const id = formData.get("id") as string;
    const result = await apiFetch(request, `/api/catalog/products/${id}`, { method: "DELETE" });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return redirect("/products");
  }

  return json({ error: "Intent tidak dikenal" }, { status: 400 });
}

export default function ProductsPage() {
  const { products, meta, categories } = useLoaderData<typeof loader>();
  const actionData    = useActionData<typeof action>();
  const nav           = useNavigation();
  const isSubmitting  = nav.state === "submitting";
  const isAdmin       = isAdminRole(useAdminRole());

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Manajemen Produk</h1>
        <p className="text-sm text-gray-400">{meta.total} produk total</p>
      </div>

      {/* Create Form */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="font-semibold text-gray-700 mb-4">Tambah Produk</h2>
        <Form method="post" className="grid grid-cols-2 gap-4">
          <input type="hidden" name="intent" value="create" />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nama Produk</label>
            <input name="name" required className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Slug</label>
            <input name="slug" required placeholder="kaos-polos-hitam" className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">SKU</label>
            <input name="sku" required className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Kategori</label>
            <select name="categoryId" className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Tanpa kategori</option>
              {categories.map((cat: any) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Harga Jual (Rp)</label>
            <input name="price" type="number" min={0} required className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Harga Modal (Rp) <span className="text-gray-400">— opsional</span>
            </label>
            <input name="costPrice" type="number" min={0} placeholder="Kosongkan jika belum tahu" className="w-full border rounded-lg px-3 py-2 text-sm" />
            <p className="text-[11px] text-gray-400 mt-1">Dipakai menghitung margin. Tidak pernah tampil di storefront.</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Berat (gram)</label>
            <input name="weight" type="number" min={0} defaultValue={0} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">URL Gambar (opsional)</label>
            <input name="imageUrl" placeholder="https://... (hasil upload dari /api/upload/product-image)" className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Deskripsi</label>
            <textarea name="description" rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select name="status" defaultValue="draft" className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="draft">Draft</option>
              <option value="active">Aktif</option>
            </select>
          </div>

          {Boolean(actionData?.error) && (
            <p className="col-span-2 text-red-500 text-sm">{formatApiError(actionData?.error)}</p>
          )}

          <div className="col-span-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {isSubmitting ? "Menyimpan..." : "Simpan Produk"}
            </button>
          </div>
        </Form>
      </div>

      {/* Product List */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[46rem]">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Nama</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">SKU</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Harga</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Margin</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {products.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">Belum ada produk</td></tr>
            ) : (
              products.map((p: any) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.category?.name ?? "Tanpa kategori"}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{p.sku}</td>
                  <td className="px-4 py-3 text-gray-800">
                    <p>Rp {p.price?.toLocaleString("id-ID")}</p>
                    <p className="text-xs text-gray-400">
                      {p.costPrice != null
                        ? `Modal Rp ${p.costPrice.toLocaleString("id-ID")}`
                        : "Modal belum diisi"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const margin = grossMarginPct(p.price, p.costPrice);
                      if (margin == null) return <span className="text-xs text-gray-300">—</span>;
                      return (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          margin < 0 ? "bg-red-100 text-red-700"
                          : margin < 15 ? "bg-yellow-100 text-yellow-700"
                          : "bg-green-100 text-green-700"
                        }`}>
                          {margin}%
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[p.status] ?? "bg-gray-100"}`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <Link to={`/products/${p.id}`} className="text-blue-600 hover:underline text-xs">Edit</Link>
                    {p.status !== "active" && (
                      <Form method="post" className="inline">
                        <input type="hidden" name="intent" value="update_status" />
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="status" value="active" />
                        <button type="submit" className="text-green-600 hover:underline text-xs">Aktifkan</button>
                      </Form>
                    )}
                    {isAdmin && p.status !== "archived" && (
                      <Form method="post" className="inline">
                        <input type="hidden" name="intent" value="archive" />
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className="text-red-500 hover:underline text-xs">Arsipkan</button>
                      </Form>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      <Pager page={meta.page} limit={meta.limit} total={meta.total} basePath="/products" />
    </div>
  );
}
