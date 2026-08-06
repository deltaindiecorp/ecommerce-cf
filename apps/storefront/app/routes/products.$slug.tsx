import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, useNavigation, Link } from "@remix-run/react";
import { useState } from "react";

import { API_BASE } from "~/lib/config";
import { SiteHeader } from "~/components/SiteHeader";
import { SiteFooter } from "~/components/SiteFooter";
import { MobileBottomNav } from "~/components/MobileBottomNav";

export async function loader({ params }: LoaderFunctionArgs) {
  const res = await fetch(`${API_BASE}/api/catalog/products/${params.slug}`);
  if (!res.ok) throw new Response("Produk tidak ditemukan", { status: 404 });
  const { data: product } = await res.json() as any;
  return json({ product });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData  = await request.formData();
  const cartId    = request.headers.get("Cookie")?.match(/cartId=([^;]+)/)?.[1] ?? crypto.randomUUID();
  const productId = formData.get("productId") as string;
  const variantId = formData.get("variantId") as string | null;
  const qty       = Number(formData.get("qty") ?? 1);

  const res = await fetch(`${API_BASE}/api/cart/add`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "X-Cart-Id": cartId },
    body:    JSON.stringify({ productId, variantId: variantId || undefined, qty }),
  });

  const result = await res.json() as any;
  if (!result.success) return json({ error: result.error }, { status: 400 });

  const newCartId = result.cartId ?? cartId;
  return redirect("/cart", {
    headers: { "Set-Cookie": `cartId=${newCartId}; Path=/; Max-Age=86400; SameSite=Lax` },
  });
}

export default function ProductDetailPage() {
  const { product }      = useLoaderData<typeof loader>();
  const actionData       = useActionData<typeof action>();
  const nav              = useNavigation();
  const isAdding         = nav.state === "submitting";
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [qty, setQty]    = useState(1);

  const variant       = product.variants?.find((v: any) => v.id === selectedVariant);
  const price         = variant?.price ?? product.price;
  const stockKey      = selectedVariant ?? "__base__";
  const availableStock= product.stock?.[stockKey] ?? 0;

  // Group variant options by type (e.g. color, size)
  const variantOptions: Record<string, any[]> = {};
  for (const v of product.variants ?? []) {
    const opts = v.options ?? {};
    for (const [key, val] of Object.entries(opts)) {
      if (!variantOptions[key]) variantOptions[key] = [];
      if (!variantOptions[key].includes(val)) variantOptions[key].push(val);
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col pb-16 md:pb-0">
      <SiteHeader />
      {/* Breadcrumb */}
      <div className="max-w-4xl mx-auto px-4 py-4 text-sm text-gray-400 w-full">
        <Link to="/" className="hover:text-blue-600">Beranda</Link>
        <span className="mx-2">/</span>
        {product.category && (
          <>
            <Link to={`/?category=${product.category.id}`} className="hover:text-blue-600">
              {product.category.name}
            </Link>
            <span className="mx-2">/</span>
          </>
        )}
        <span className="text-gray-700">{product.name}</span>
      </div>

      <div className="flex-1 max-w-4xl mx-auto px-4 pb-12 w-full">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Images */}
          <div className="aspect-square bg-gray-100 rounded-xl overflow-hidden">
            {product.images?.[0] ? (
              <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-300 text-6xl">📦</div>
            )}
          </div>

          {/* Info */}
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{product.name}</h1>
            <p className="text-3xl font-bold text-blue-600 mb-4">
              Rp {price.toLocaleString("id-ID")}
            </p>

            {/* Variants */}
            {Object.entries(variantOptions).map(([optKey, vals]) => (
              <div key={optKey} className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2 capitalize">{optKey}</p>
                <div className="flex flex-wrap gap-2">
                  {product.variants
                    .filter((v: any) => v.options?.[optKey])
                    .map((v: any) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVariant(v.id)}
                        className={`px-3 py-1.5 border rounded-lg text-sm transition-colors ${
                          selectedVariant === v.id
                            ? "border-blue-600 bg-blue-50 text-blue-700"
                            : "border-gray-200 hover:border-gray-400"
                        }`}
                      >
                        {v.options?.[optKey]}
                      </button>
                    ))}
                </div>
              </div>
            ))}

            {/* Qty */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm text-gray-600">Jumlah:</span>
              <div className="flex items-center border rounded-lg">
                <button
                  type="button"
                  onClick={() => setQty(q => Math.max(1, q - 1))}
                  className="px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-l-lg"
                >-</button>
                <span className="px-4 py-2 text-sm font-medium">{qty}</span>
                <button
                  type="button"
                  onClick={() => setQty(q => Math.min(availableStock, q + 1))}
                  className="px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-r-lg"
                >+</button>
              </div>
              <span className="text-sm text-gray-400">Stok: {availableStock}</span>
            </div>

            {actionData?.error && (
              <p className="text-red-500 text-sm mb-3">{String(actionData.error)}</p>
            )}

            <Form method="post">
              <input type="hidden" name="productId" value={product.id} />
              {selectedVariant && <input type="hidden" name="variantId" value={selectedVariant} />}
              <input type="hidden" name="qty" value={qty} />
              <button
                type="submit"
                disabled={isAdding || availableStock === 0 || (product.variants?.length > 0 && !selectedVariant)}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isAdding ? "Menambahkan..." : availableStock === 0 ? "Stok Habis" : "Tambah ke Keranjang"}
              </button>
            </Form>

            {product.variants?.length > 0 && !selectedVariant && (
              <p className="text-amber-600 text-sm mt-2">Pilih varian terlebih dahulu</p>
            )}

            {/* Description */}
            {product.description && (
              <div className="mt-6 pt-6 border-t">
                <h2 className="font-semibold text-gray-700 mb-2">Deskripsi</h2>
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{product.description}</p>
              </div>
            )}
          </div>
        </div>
      </div>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
