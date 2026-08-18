import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, Link, useNavigation } from "@remix-run/react";
import { useState } from "react";

import { apiFetch, apiPublic, formatApiError } from "~/lib/api";
import { ImageManager } from "~/components/ImageManager";

// ─── Pembacaan form ───────────────────────────────────────────────────────────
// Field kosong dikirim sebagai null (bukan undefined) supaya benar-benar
// mengosongkan kolom di DB. Kalau dikirim undefined, drizzle melewatinya dan
// nilai lama bertahan — jadi "hapus harga modal" tidak akan pernah berefek.
function optText(fd: FormData, key: string): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : v;
}

function optNum(fd: FormData, key: string): number | null {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : Number(v);
}

function numOrZero(fd: FormData, key: string): number {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? 0 : Number(v);
}

function linesToArray(fd: FormData, key: string): string[] {
  return String(fd.get(key) ?? "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);
}

function csvToArray(fd: FormData, key: string): string[] {
  return String(fd.get(key) ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

// Opsi varian disimpan sebagai Record<string,string> (mis. {warna:"Merah"}).
// Di form ditulis "warna: Merah, ukuran: XL" — jauh lebih ramah daripada JSON.
function parseOptions(fd: FormData, key: string): Record<string, string> {
  const raw = String(fd.get(key) ?? "").trim();
  if (!raw) return {};

  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const sep = pair.indexOf(":");
    if (sep === -1) continue;
    const k = pair.slice(0, sep).trim();
    const v = pair.slice(sep + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function formatOptions(options?: Record<string, string> | null): string {
  if (!options) return "";
  return Object.entries(options).map(([k, v]) => `${k}: ${v}`).join(", ");
}

function variantPayload(fd: FormData) {
  return {
    name:      String(fd.get("v_name") ?? ""),
    sku:       String(fd.get("v_sku") ?? ""),
    price:     optNum(fd, "v_price"),
    costPrice: optNum(fd, "v_costPrice"),
    weight:    optNum(fd, "v_weight"),
    imageUrl:  optText(fd, "v_imageUrl"),
    options:   parseOptions(fd, "v_options"),
    isActive:  fd.get("v_isActive") === "on",
  };
}

function grossMarginPct(price?: number | null, cost?: number | null): number | null {
  if (cost == null || !price) return null;
  return Math.round(((price - cost) / price) * 100);
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const [productBody, categoriesBody] = await Promise.all([
    apiFetch<any>(request, `/api/admin/products/${params.id}`),
    apiPublic<any[]>("/api/catalog/categories"),
  ]);

  if (!productBody.success) throw new Response("Produk tidak ditemukan", { status: 404 });

  return json({
    product:    productBody.data,
    categories: categoriesBody.data ?? [],
  });
}

export async function action({ params, request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent   = String(formData.get("intent") ?? "update_product");
  const variantsUrl = `/api/catalog/products/${params.id}/variants`;

  // `scope` dipakai UI untuk menaruh pesan di panel yang benar — error varian
  // di bagian varian, bukan di atas form produk.
  if (intent === "create_variant") {
    const result = await apiFetch(request, variantsUrl, {
      method: "POST", body: JSON.stringify(variantPayload(formData)),
    });
    if (!result.success) return json({ ok: false, error: result.error, scope: "variant" }, { status: 400 });
    return json({ ok: true, error: null, scope: "variant" });
  }

  if (intent === "update_variant") {
    const variantId = String(formData.get("variantId") ?? "");
    const result = await apiFetch(request, `${variantsUrl}/${variantId}`, {
      method: "PATCH", body: JSON.stringify(variantPayload(formData)),
    });
    if (!result.success) return json({ ok: false, error: result.error, scope: "variant" }, { status: 400 });
    return json({ ok: true, error: null, scope: "variant" });
  }

  const payload = {
    name:         String(formData.get("name") ?? ""),
    slug:         String(formData.get("slug") ?? ""),
    sku:          String(formData.get("sku") ?? ""),
    categoryId:   optText(formData, "categoryId"),
    description:  optText(formData, "description"),
    price:        numOrZero(formData, "price"),
    comparePrice: optNum(formData, "comparePrice"),
    costPrice:    optNum(formData, "costPrice"),
    weight:       numOrZero(formData, "weight"),
    width:        numOrZero(formData, "width"),
    height:       numOrZero(formData, "height"),
    length:       numOrZero(formData, "length"),
    images:       linesToArray(formData, "images"),
    tags:         csvToArray(formData, "tags"),
    status:       String(formData.get("status") ?? "draft"),
    isFeatured:     formData.get("isFeatured") === "on",
    trackInventory: formData.get("trackInventory") === "on",
    metaTitle:    optText(formData, "metaTitle"),
    metaDesc:     optText(formData, "metaDesc"),
  };

  const result = await apiFetch(request, `/api/catalog/products/${params.id}`, {
    method: "PATCH", body: JSON.stringify(payload),
  });

  if (!result.success) return json({ ok: false, error: result.error, scope: "product" }, { status: 400 });
  return json({ ok: true, error: null, scope: "product" });
}

const FIELD = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const LABEL = "block text-xs font-medium text-gray-500 mb-1";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl shadow-sm p-6">
      <h2 className="font-semibold text-gray-700">{title}</h2>
      {hint && <p className="text-xs text-gray-400 mt-0.5 mb-4">{hint}</p>}
      <div className={hint ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

// Stok milik gudang, bukan milik produk — satu produk bisa punya stok di
// beberapa gudang sekaligus. Panel ini merangkumnya tanpa memindahkan
// kepemilikan datanya.
function StokProduk({ product }: { product: any }) {
  const baris: any[] = product.stock ?? [];

  if (product.trackInventory === false) {
    return (
      <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 px-5 py-3.5 text-sm text-gray-600">
        <span className="font-medium text-gray-700">Stok tidak dilacak.</span>{" "}
        Produk ini bisa dipesan tanpa perlu punya stok di gudang.
      </div>
    );
  }

  const totalOnHand   = baris.reduce((n, r) => n + (r.qtyOnHand ?? 0), 0);
  const totalReserved = baris.reduce((n, r) => n + (r.qtyReserved ?? 0), 0);

  return (
    <div className="mb-5 rounded-xl bg-white shadow-sm px-5 py-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="font-semibold text-gray-700">Stok</h2>
        <span className={`text-2xl font-bold ${totalOnHand > 0 ? "text-gray-800" : "text-red-600"}`}>
          {totalOnHand}
        </span>
        {totalReserved > 0 && (
          <span className="text-xs text-gray-400">{totalReserved} sedang dipesan</span>
        )}
        <Link to="/warehouse" className="ml-auto text-xs text-blue-600 hover:underline">
          Kelola stok di Gudang →
        </Link>
      </div>

      {baris.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">
          Belum ada stok di gudang mana pun — produk ini tidak akan bisa dipesan.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {baris.map((r, i) => (
            <li key={`${r.warehouseId}-${r.variantId ?? "induk"}-${i}`} className="flex items-baseline gap-2 text-xs">
              <span className="text-gray-600">{r.warehouseName}</span>
              <span className="font-mono text-gray-300">{r.warehouseCode}</span>
              {r.variantId && <span className="text-gray-400">· varian</span>}
              <span className="ml-auto font-medium text-gray-700">{r.qtyOnHand}</span>
              {r.qtyReserved > 0 && <span className="text-gray-400">({r.qtyReserved} dipesan)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ProductEditPage() {
  const { product, categories } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav        = useNavigation();
  const isSaving   = nav.state === "submitting";

  // Dipantau di client supaya margin ikut berubah saat harga diketik.
  const [price, setPrice] = useState<string>(String(product.price ?? ""));
  const [cost, setCost]   = useState<string>(product.costPrice != null ? String(product.costPrice) : "");

  const liveMargin = grossMarginPct(
    price === "" ? null : Number(price),
    cost  === "" ? null : Number(cost),
  );

  const productMsg = actionData?.scope === "product" ? actionData : null;
  const variantMsg = actionData?.scope === "variant" ? actionData : null;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/products" className="text-gray-400 hover:text-gray-600 text-sm">← Kembali</Link>
        <h1 className="text-xl font-bold text-gray-800 truncate">{product.name}</h1>
        <span className="ml-auto text-xs text-gray-400 font-mono shrink-0">{product.sku}</span>
      </div>

      {/* Ringkasan stok ditaruh di ATAS, sebelum form: pertanyaan pertama orang
          saat membuka sebuah produk adalah "stoknya berapa", dan sebelumnya
          jawabannya tidak ada di halaman ini sama sekali — hanya di halaman
          gudang, yang tidak pernah terpikirkan dari sini. */}
      <StokProduk product={product} />

      {productMsg?.ok && (
        <p className="mb-4 text-sm bg-green-50 text-green-700 border border-green-100 rounded-lg px-4 py-2.5">
          Perubahan tersimpan.
        </p>
      )}
      {Boolean(productMsg?.error) && (
        <pre className="mb-4 text-xs bg-red-50 text-red-700 border border-red-100 rounded-lg px-4 py-2.5 whitespace-pre-wrap">
          {formatApiError(productMsg?.error)}
        </pre>
      )}

      <Form method="post" className="space-y-5">
        <input type="hidden" name="intent" value="update_product" />
        <Section title="Informasi Dasar">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Nama Produk</label>
              <input name="name" required defaultValue={product.name ?? ""} className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>Slug</label>
              <input name="slug" required defaultValue={product.slug ?? ""} className={FIELD} />
              <p className="text-[11px] text-gray-400 mt-1">Mengubah slug memutus URL lama produk ini.</p>
            </div>
            <div>
              <label className={LABEL}>SKU</label>
              <input name="sku" required defaultValue={product.sku ?? ""} className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>Kategori</label>
              <select name="categoryId" defaultValue={product.categoryId ?? ""} className={FIELD}>
                <option value="">Tanpa kategori</option>
                {categories.map((cat: any) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className={LABEL}>Deskripsi</label>
              <textarea name="description" rows={4} defaultValue={product.description ?? ""} className={FIELD} />
            </div>
          </div>
        </Section>

        <Section title="Harga" hint="Harga modal hanya dipakai internal untuk menghitung margin — tidak pernah dikirim ke storefront.">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={LABEL}>Harga Jual (Rp)</label>
              <input
                name="price" type="number" min={1} required
                value={price} onChange={e => setPrice(e.target.value)}
                className={FIELD}
              />
            </div>
            <div>
              <label className={LABEL}>Harga Modal (Rp)</label>
              <input
                name="costPrice" type="number" min={0} placeholder="Kosongkan bila belum tahu"
                value={cost} onChange={e => setCost(e.target.value)}
                className={FIELD}
              />
            </div>
            <div>
              <label className={LABEL}>Harga Coret (Rp)</label>
              <input
                name="comparePrice" type="number" min={1}
                defaultValue={product.comparePrice ?? ""} placeholder="Opsional"
                className={FIELD}
              />
            </div>
          </div>
          <div className="mt-3 text-sm">
            {liveMargin == null ? (
              <span className="text-gray-400">Margin belum bisa dihitung — harga modal kosong.</span>
            ) : (
              <span className={
                liveMargin < 0 ? "text-red-600 font-medium"
                : liveMargin < 15 ? "text-yellow-700 font-medium"
                : "text-green-700 font-medium"
              }>
                Margin kotor: {liveMargin}%
                {liveMargin < 0 && " — harga jual di bawah modal"}
              </span>
            )}
          </div>
        </Section>

        <Section title="Pengiriman" hint="Dimensi dipakai untuk ongkir volumetrik. Kosong dianggap 0.">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className={LABEL}>Berat (gram)</label>
              <input name="weight" type="number" min={0} defaultValue={product.weight ?? 0} className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>Panjang (cm)</label>
              <input name="length" type="number" min={0} defaultValue={product.length ?? 0} className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>Lebar (cm)</label>
              <input name="width" type="number" min={0} defaultValue={product.width ?? 0} className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>Tinggi (cm)</label>
              <input name="height" type="number" min={0} defaultValue={product.height ?? 0} className={FIELD} />
            </div>
          </div>
        </Section>

        <Section title="Media & Tag">
          <div className="space-y-4">
            <div>
              <label className={LABEL}>Gambar Produk</label>
              <ImageManager name="images" initial={product.images ?? []} />
            </div>
            <div>
              <label className={LABEL}>Tag — pisahkan dengan koma</label>
              <input
                name="tags"
                defaultValue={(product.tags ?? []).join(", ")}
                placeholder="kaos, katun, unisex"
                className={FIELD}
              />
            </div>
          </div>
        </Section>

        <Section title="SEO">
          <div className="space-y-4">
            <div>
              <label className={LABEL}>Meta Title</label>
              <input name="metaTitle" defaultValue={product.metaTitle ?? ""} className={FIELD} />
            </div>
            <div>
              <label className={LABEL}>Meta Description</label>
              <textarea name="metaDesc" rows={2} defaultValue={product.metaDesc ?? ""} className={FIELD} />
            </div>
          </div>
        </Section>

        <Section title="Publikasi">
          <div className="grid grid-cols-2 gap-4 items-start">
            <div>
              <label className={LABEL}>Status</label>
              <select name="status" defaultValue={product.status ?? "draft"} className={FIELD}>
                <option value="draft">Draft</option>
                <option value="active">Aktif</option>
                <option value="archived">Arsip</option>
              </select>
            </div>
            <div className="space-y-3 mt-6">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox" name="isFeatured"
                  defaultChecked={Boolean(product.isFeatured)}
                  className="rounded border-gray-300"
                />
                Tampilkan sebagai produk unggulan
              </label>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox" name="trackInventory"
                    defaultChecked={product.trackInventory !== false}
                    className="rounded border-gray-300"
                  />
                  Lacak stok produk ini
                </label>
                <p className="text-[11px] text-gray-400 mt-1 ml-6">
                  Matikan untuk jasa, produk digital, pre-order, atau made-to-order —
                  produk tanpa pelacakan bisa dipesan tanpa perlu punya stok di gudang.
                </p>
              </div>
            </div>
          </div>
        </Section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSaving}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? "Menyimpan..." : "Simpan Perubahan"}
          </button>
          <Link to="/products" className="text-sm text-gray-500 hover:text-gray-700">Batal</Link>
        </div>
      </Form>

      {/* ─── Varian ─────────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl shadow-sm p-6 mt-5">
        <h2 className="font-semibold text-gray-700">Varian</h2>
        <p className="text-xs text-gray-400 mt-0.5 mb-4">
          Harga, modal, dan berat yang dikosongkan akan mengikuti nilai produk induk.
          Stok dikelola terpisah per gudang.
        </p>

        {variantMsg?.ok && (
          <p className="mb-4 text-sm bg-green-50 text-green-700 border border-green-100 rounded-lg px-4 py-2.5">
            Varian tersimpan.
          </p>
        )}
        {Boolean(variantMsg?.error) && (
          <pre className="mb-4 text-xs bg-red-50 text-red-700 border border-red-100 rounded-lg px-4 py-2.5 whitespace-pre-wrap">
            {formatApiError(variantMsg?.error)}
          </pre>
        )}

        <div className="space-y-3">
          {!product.variants?.length ? (
            <p className="text-sm text-gray-400">Produk ini belum punya varian.</p>
          ) : (
            product.variants.map((v: any) => (
              <div
                key={v.id}
                className={`border rounded-lg p-4 ${v.isActive ? "border-gray-200" : "border-gray-100 bg-gray-50/60"}`}
              >
                {/* id dipasang supaya tombol simpan bisa berada di luar <Form> —
                    menghindari form bersarang yang tidak valid di HTML. */}
                <Form method="post" id={`variant-${v.id}`} className="space-y-3">
                  <input type="hidden" name="intent" value="update_variant" />
                  <input type="hidden" name="variantId" value={v.id} />

                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-4">
                      <label className={LABEL}>Nama Varian</label>
                      <input name="v_name" required defaultValue={v.name ?? ""} className={FIELD} />
                    </div>
                    <div className="col-span-3">
                      <label className={LABEL}>SKU</label>
                      <input name="v_sku" required defaultValue={v.sku ?? ""} className={`${FIELD} font-mono text-xs`} />
                    </div>
                    <div className="col-span-2">
                      <label className={LABEL}>Harga (Rp)</label>
                      <input name="v_price" type="number" min={1} placeholder="Ikut produk"
                        defaultValue={v.price ?? ""} className={FIELD} />
                    </div>
                    <div className="col-span-2">
                      <label className={LABEL}>Modal (Rp)</label>
                      <input name="v_costPrice" type="number" min={0} placeholder="Ikut produk"
                        defaultValue={v.costPrice ?? ""} className={FIELD} />
                    </div>
                    <div className="col-span-1">
                      <label className={LABEL}>Berat</label>
                      <input name="v_weight" type="number" min={0} placeholder="—"
                        defaultValue={v.weight ?? ""} className={FIELD} />
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-5">
                      <label className={LABEL}>Opsi</label>
                      <input name="v_options" placeholder="warna: Merah, ukuran: XL"
                        defaultValue={formatOptions(v.options)} className={FIELD} />
                    </div>
                    <div className="col-span-5">
                      <label className={LABEL}>URL Gambar</label>
                      <input name="v_imageUrl" defaultValue={v.imageUrl ?? ""}
                        className={`${FIELD} font-mono text-xs`} />
                    </div>
                    <div className="col-span-2 flex items-end pb-2">
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" name="v_isActive" defaultChecked={Boolean(v.isActive)}
                          className="rounded border-gray-300" />
                        Aktif
                      </label>
                    </div>
                  </div>
                </Form>

                <div className="flex items-center gap-3 mt-3">
                  <button
                    type="submit" form={`variant-${v.id}`} disabled={isSaving}
                    className="bg-gray-800 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-900 disabled:opacity-50"
                  >
                    Simpan Varian
                  </button>
                  {!v.isActive && (
                    <span className="text-xs text-gray-400">
                      Nonaktif — tidak tampil di storefront. Centang &ldquo;Aktif&rdquo; lalu simpan untuk mengaktifkan.
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Tambah varian */}
        <div className="border-t border-gray-100 mt-5 pt-5">
          <h3 className="text-sm font-medium text-gray-600 mb-3">Tambah Varian</h3>
          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="create_variant" />
            <input type="hidden" name="v_isActive" value="on" />

            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-4">
                <label className={LABEL}>Nama Varian</label>
                <input name="v_name" required placeholder="Merah / XL" className={FIELD} />
              </div>
              <div className="col-span-3">
                <label className={LABEL}>SKU</label>
                <input name="v_sku" required placeholder="KP-001-MRH-XL" className={`${FIELD} font-mono text-xs`} />
              </div>
              <div className="col-span-2">
                <label className={LABEL}>Harga (Rp)</label>
                <input name="v_price" type="number" min={1} placeholder="Ikut produk" className={FIELD} />
              </div>
              <div className="col-span-2">
                <label className={LABEL}>Modal (Rp)</label>
                <input name="v_costPrice" type="number" min={0} placeholder="Ikut produk" className={FIELD} />
              </div>
              <div className="col-span-1">
                <label className={LABEL}>Berat</label>
                <input name="v_weight" type="number" min={0} placeholder="—" className={FIELD} />
              </div>
            </div>

            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-5">
                <label className={LABEL}>Opsi</label>
                <input name="v_options" placeholder="warna: Merah, ukuran: XL" className={FIELD} />
              </div>
              <div className="col-span-5">
                <label className={LABEL}>URL Gambar</label>
                <input name="v_imageUrl" className={`${FIELD} font-mono text-xs`} />
              </div>
              <div className="col-span-2 flex items-end">
                <button
                  type="submit" disabled={isSaving}
                  className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  Tambah
                </button>
              </div>
            </div>
          </Form>
        </div>
      </section>
    </div>
  );
}
