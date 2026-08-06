import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";

import { API_BASE } from "~/lib/config";
import { SiteHeader } from "~/components/SiteHeader";
import { SiteFooter } from "~/components/SiteFooter";
import { ProductCard } from "~/components/ProductCard";
import { MobileBottomNav } from "~/components/MobileBottomNav";
import { getCategoryIcon } from "~/lib/category-icon";

export async function loader({ request }: LoaderFunctionArgs) {
  const url         = new URL(request.url);
  const page        = url.searchParams.get("page") ?? "1";
  const search      = url.searchParams.get("search") ?? "";
  const rawCategory = url.searchParams.get("category") ?? "";
  // "all" = sentinel dari link "Lihat Semua" (paksa mode browse tanpa filter
  // kategori beneran — string kosong dianggap "belum browsing" / masih di beranda)
  const isBrowsing = Boolean(search || rawCategory);
  const category    = rawCategory === "all" ? "" : rawCategory;

  const categoriesRes  = await fetch(`${API_BASE}/api/catalog/categories`);
  const categoriesBody = await categoriesRes.json() as any;
  const categories      = categoriesBody.data ?? [];

  if (!isBrowsing) {
    // Landing page: kategori pilihan + produk unggulan (isFeatured), bukan hasil filter
    const featuredRes  = await fetch(`${API_BASE}/api/catalog/products?limit=8&featured=true`);
    const featuredBody = await featuredRes.json() as any;
    return json({ mode: "home" as const, categories, featured: featuredBody.data ?? [] });
  }

  const params = new URLSearchParams({ page, limit: "12" });
  if (search)   params.set("search", search);
  if (category) params.set("category", category);

  const productsRes  = await fetch(`${API_BASE}/api/catalog/products?${params}`);
  const productsBody = await productsRes.json() as any;

  return json({
    mode:       "browse" as const,
    categories,
    products:   productsBody.data ?? [],
    meta:       productsBody.meta ?? { page: 1, limit: 12, total: 0 },
    search,
    category,
  });
}

export default function IndexPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-16 md:pb-0">
      <SiteHeader />

      <div className="flex-1">
        {data.mode === "home" ? (
          <HomeContent categories={data.categories} featured={data.featured} />
        ) : (
          <BrowseContent
            categories={data.categories}
            products={data.products}
            meta={data.meta}
            search={data.search}
            category={data.category}
          />
        )}
      </div>

      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}

// ─── Homepage (hero + kategori + produk unggulan) ─────────────────────────
function HomeContent({ categories, featured }: { categories: any[]; featured: any[] }) {
  return (
    <>
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-6">
        <div className="rounded-2xl bg-gradient-to-r from-blue-700 to-blue-900 text-white px-8 py-14 md:py-20 md:px-14">
          <h1 className="text-3xl md:text-5xl font-bold mb-3 max-w-lg">Belanja Lebih Mudah, Lebih Hemat</h1>
          <p className="text-blue-100 max-w-md mb-6">
            Temukan produk pilihan dengan kualitas terbaik dan harga bersaing.
          </p>
          <a
            href="#produk-terpopuler"
            className="inline-block bg-white text-blue-700 font-semibold px-6 py-3 rounded-lg hover:bg-blue-50 transition-colors"
          >
            Belanja Sekarang
          </a>
        </div>
      </section>

      {/* Kategori Pilihan */}
      {categories.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-8">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Kategori Pilihan</h2>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-x-2 gap-y-4">
            {categories.slice(0, 8).map((cat: any) => (
              <Link key={cat.id} to={`/?category=${cat.id}`} className="group flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-full bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center text-2xl transition-colors shadow-sm">
                  {getCategoryIcon(cat.name)}
                </div>
                <span className="text-xs text-gray-600 text-center line-clamp-1">{cat.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Produk Terpopuler */}
      <section id="produk-terpopuler" className="max-w-6xl mx-auto px-4 py-10">
        <div className="flex justify-between items-end mb-4">
          <h2 className="text-xl font-bold text-gray-800">Produk Terpopuler</h2>
          <Link to="/?category=all" className="text-sm text-blue-600 hover:underline">Lihat Semua</Link>
        </div>

        {featured.length === 0 ? (
          <p className="text-gray-400 text-center py-12">Belum ada produk unggulan saat ini.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {featured.map((p: any) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </section>
    </>
  );
}

// ─── Browse/search mode (kategori + grid terfilter + pagination) ──────────
function BrowseContent({ categories, products, meta, search, category }: {
  categories: any[]; products: any[]; meta: { page: number; limit: number; total: number };
  search: string; category: string;
}) {
  const totalPages = Math.ceil(meta.total / meta.limit);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex gap-6">
      <aside className="w-48 shrink-0 hidden md:block">
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

      <main className="flex-1">
        {search && (
          <p className="text-sm text-gray-500 mb-4">
            Hasil pencarian untuk: <strong>"{search}"</strong> ({meta.total} produk)
          </p>
        )}

        {products.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">Produk tidak ditemukan</p>
            <Link to="/" className="text-blue-600 text-sm mt-2 inline-block">Kembali ke beranda</Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((p: any) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-8">
            {meta.page > 1 && (
              <Link
                to={`?page=${meta.page - 1}${search ? `&search=${search}` : ""}${category ? `&category=${category}` : ""}`}
                className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-100"
              >
                ← Prev
              </Link>
            )}
            <span className="px-4 py-2 text-sm text-gray-600">{meta.page} / {totalPages}</span>
            {meta.page < totalPages && (
              <Link
                to={`?page=${meta.page + 1}${search ? `&search=${search}` : ""}${category ? `&category=${category}` : ""}`}
                className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-100"
              >
                Next →
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
