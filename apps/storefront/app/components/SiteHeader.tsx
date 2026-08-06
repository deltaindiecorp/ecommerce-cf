import { Link, Form, useRouteLoaderData } from "@remix-run/react";
import type { loader as rootLoader } from "~/root";

export function SiteHeader() {
  const rootData    = useRouteLoaderData<typeof rootLoader>("root");
  const categories  = rootData?.categories ?? [];
  const cartCount   = rootData?.cartItemCount ?? 0;

  return (
    <header className="bg-white shadow-sm sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link to="/" className="text-xl font-bold text-blue-600 shrink-0">Deltacommerce</Link>

        <nav className="hidden md:flex items-center gap-5 shrink-0">
          <Link to="/" className="text-sm font-medium text-blue-600">Beranda</Link>
          {categories.slice(0, 4).map((cat: any) => (
            <Link
              key={cat.id}
              to={`/?category=${cat.id}`}
              className="text-sm text-gray-600 hover:text-blue-600 transition-colors"
            >
              {cat.name}
            </Link>
          ))}
        </nav>

        <Form method="get" action="/" className="flex-1 flex gap-2">
          <input
            name="search"
            placeholder="Cari produk..."
            className="w-full border rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="sr-only">Cari</button>
        </Form>

        <div className="flex items-center gap-3 shrink-0 text-lg">
          <Link to="/cart" aria-label="Keranjang" className="relative text-gray-600 hover:text-blue-600 transition-colors">
            🛒
            {cartCount > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-red-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {cartCount > 9 ? "9+" : cartCount}
              </span>
            )}
          </Link>
          <Link to="/auth/login" aria-label="Akun" className="text-gray-600 hover:text-blue-600 transition-colors">👤</Link>
        </div>
      </div>
    </header>
  );
}
