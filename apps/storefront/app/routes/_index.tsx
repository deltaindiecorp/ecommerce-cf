import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData, Link, Form, useSearchParams } from "@remix-run/react";

import { API_BASE } from "~/lib/config";

export async function loader({ request }: LoaderFunctionArgs) {
  const url        = new URL(request.url);
  const page       = url.searchParams.get("page") ?? "1";
  const search     = url.searchParams.get("search") ?? "";
  const category   = url.searchParams.get("category") ?? "";

  const params = new URLSearchParams({ page, limit: "12" });
  if (search)   params.set("search", search);
  if (category) params.set("category", category);

  const [productsRes, categoriesRes] = await Promise.all([
    fetch(`${API_BASE}/api/catalog/products?${params}`),
    fetch(`${API_BASE}/api/catalog/categories`),
  ]);

  const products   = await productsRes.json() as any;
  const categories = await categoriesRes.json() as any;

  return json({
    products:   products.data   ?? [],
    meta:       products.meta   ?? { page: 1, limit: 12, total: 0 },
    categories: categories.data ?? [],
    search,
    category,
  });
}

export default function IndexPage() {
  const { products, meta, categories, search, category } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const currentPage = Number(searchParams.get("page") ?? 1);
  const totalPages  = Math.ceil(meta.total / meta.limit);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link to="/" className="text-xl font-bold text-blue-600">Toko</Link>
          <Form method="get" className="flex-1 flex gap-2">
            <input
              name="search"
              defaultValue={search}
              placeholder="Cari produk..."
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
            />
            {category && <input type="hidden" name="category" value={category} />}
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
              Cari
            </button>
          </Form>
          <Link to="/cart" className="text-sm text-gray-600 hover:text-blue-600">
            🛒 Keranjang
          </Link>
          <Link to="/auth/login" className="text-sm text-gray-600 hover:text-blue-600">
            Masuk
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 flex gap-6">
        {/* Sidebar: Categories */}
        <aside className="w-48 shrink-0">
          <h2 className="font-semibold text-gray-700 mb-3">Kategori</h2>
          <ul className="space-y-1">
            <li>
              <Link
                to="/"
                className={`block px-3 py-2 rounded text-sm ${!category ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-100"}`}
              >
                Semua Produk
              </Link>
            </li>
            {categories.map((cat: any) => (
              <li key={cat.id}>
                <Link
                  to={`/?category=${cat.id}`}
                  className={`block px-3 py-2 rounded text-sm ${category === cat.id ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-100"}`}
                >
                  {cat.name}
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        {/* Product Grid */}
        <main className="flex-1">
          {search && (
            <p className="text-sm text-gray-500 mb-4">
              Hasil pencarian untuk: <strong>"{search}"</strong> ({meta.total} produk)
            </p>
          )}

          {products.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <p className="text-lg">Produk tidak ditemukan</p>
              <Link to="/" className="text-blue-600 text-sm mt-2 inline-block">Lihat semua produk</Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {products.map((p: any) => (
                <Link key={p.id} to={`/products/${p.slug}`} className="group">
                  <div className="bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                    <div className="aspect-square bg-gray-100 overflow-hidden">
                      {p.images?.[0] ? (
                        <img
                          src={p.images[0]}
                          alt={p.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl">📦</div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-sm text-gray-800 font-medium line-clamp-2 mb-1">{p.name}</p>
                      <p className="text-blue-600 font-bold text-sm">
                        Rp {p.price.toLocaleString("id-ID")}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-8">
              {currentPage > 1 && (
                <Link
                  to={`?page=${currentPage - 1}${search ? `&search=${search}` : ""}${category ? `&category=${category}` : ""}`}
                  className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-100"
                >
                  ← Prev
                </Link>
              )}
              <span className="px-4 py-2 text-sm text-gray-600">
                {currentPage} / {totalPages}
              </span>
              {currentPage < totalPages && (
                <Link
                  to={`?page=${currentPage + 1}${search ? `&search=${search}` : ""}${category ? `&category=${category}` : ""}`}
                  className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-100"
                >
                  Next →
                </Link>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
