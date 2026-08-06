import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, Form, Link, useNavigation } from "@remix-run/react";

import { API_BASE } from "~/lib/config";

function getCartId(request: Request): string | null {
  return request.headers.get("Cookie")?.match(/cartId=([^;]+)/)?.[1] ?? null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const cartId = getCartId(request);
  if (!cartId) return json({ cart: null, cartId: null });

  const res  = await fetch(`${API_BASE}/api/cart`, { headers: { "X-Cart-Id": cartId } });
  const body = await res.json() as any;
  return json({ cart: body.data ?? null, cartId });
}

export async function action({ request }: ActionFunctionArgs) {
  const cartId   = getCartId(request);
  if (!cartId) return redirect("/");

  const formData  = await request.formData();
  const intent    = formData.get("intent") as string;
  const productId = formData.get("productId") as string;
  const variantId = formData.get("variantId") as string | null;

  if (intent === "update") {
    const qty = Number(formData.get("qty") ?? 0);
    await fetch(`${API_BASE}/api/cart/item/${productId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json", "X-Cart-Id": cartId },
      body:    JSON.stringify({ qty, variantId: variantId || undefined }),
    });
  }

  if (intent === "remove") {
    await fetch(`${API_BASE}/api/cart/item/${productId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json", "X-Cart-Id": cartId },
      body:    JSON.stringify({ qty: 0, variantId: variantId || undefined }),
    });
  }

  return redirect(`/cart`);
}

export default function CartPage() {
  const { cart, cartId } = useLoaderData<typeof loader>();
  const nav              = useNavigation();
  const isUpdating       = nav.state === "submitting";

  if (!cart || cart.items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <p className="text-2xl">🛒</p>
        <p className="text-gray-600">Keranjang belanja kosong</p>
        <Link to="/" className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm">
          Mulai Belanja
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-6">
          <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">← Lanjut Belanja</Link>
          <h1 className="text-2xl font-bold">Keranjang ({cart.itemCount} item)</h1>
        </div>

        <div className="space-y-3 mb-6">
          {cart.items.map((item: any) => (
            <div key={`${item.productId}-${item.variantId}`} className="bg-white rounded-xl p-4 flex gap-4 items-center shadow-sm">
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.productName} className="w-16 h-16 object-cover rounded-lg" />
              ) : (
                <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center text-xl">📦</div>
              )}

              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 text-sm truncate">{item.productName}</p>
                {item.variantName && <p className="text-xs text-gray-500">{item.variantName}</p>}
                <p className="text-blue-600 font-semibold text-sm mt-1">
                  Rp {item.price.toLocaleString("id-ID")}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Form method="post" className="flex items-center gap-1">
                  <input type="hidden" name="intent"    value="update" />
                  <input type="hidden" name="productId" value={item.productId} />
                  {item.variantId && <input type="hidden" name="variantId" value={item.variantId} />}
                  <button
                    type="submit"
                    name="qty"
                    value={item.qty - 1}
                    disabled={isUpdating}
                    className="w-7 h-7 border rounded text-center hover:bg-gray-100 disabled:opacity-50"
                  >-</button>
                  <span className="w-8 text-center text-sm font-medium">{item.qty}</span>
                  <button
                    type="submit"
                    name="qty"
                    value={item.qty + 1}
                    disabled={isUpdating}
                    className="w-7 h-7 border rounded text-center hover:bg-gray-100 disabled:opacity-50"
                  >+</button>
                </Form>

                <Form method="post">
                  <input type="hidden" name="intent"    value="remove" />
                  <input type="hidden" name="productId" value={item.productId} />
                  {item.variantId && <input type="hidden" name="variantId" value={item.variantId} />}
                  <button
                    type="submit"
                    disabled={isUpdating}
                    className="text-red-400 hover:text-red-600 text-sm disabled:opacity-50 ml-2"
                  >✕</button>
                </Form>
              </div>

              <p className="text-sm font-semibold text-gray-800 w-24 text-right">
                Rp {item.subtotal.toLocaleString("id-ID")}
              </p>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex justify-between text-sm text-gray-600 mb-3">
            <span>Subtotal ({cart.itemCount} item)</span>
            <span>Rp {cart.subtotal.toLocaleString("id-ID")}</span>
          </div>
          <div className="flex justify-between font-bold text-lg pt-3 border-t">
            <span>Total Sementara</span>
            <span className="text-blue-600">Rp {cart.subtotal.toLocaleString("id-ID")}</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">*Belum termasuk ongkos kirim</p>

          <Link
            to={`/checkout?cartId=${cartId}`}
            className="mt-4 w-full block text-center bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            Lanjut ke Checkout
          </Link>
        </div>
      </div>
    </div>
  );
}
