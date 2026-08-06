import { Links, Meta, Outlet, Scripts, ScrollRestoration, Link, useLocation } from "@remix-run/react";
import type { LoaderFunctionArgs, LinksFunction } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import stylesheet from "./tailwind.css?url";

import { API_BASE } from "~/lib/config";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: stylesheet }];

export async function loader({ request }: LoaderFunctionArgs) {
  const token = request.headers.get("Cookie")?.match(/admin_token=([^;]+)/)?.[1];
  const pathname = new URL(request.url).pathname;

  if (pathname === "/login") return json({ authenticated: false });

  if (!token) return redirect("/login");

  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json() as any;

  if (!body.success || body.data?.role !== "admin") {
    return redirect("/login");
  }

  return json({ authenticated: true, user: body.data });
}

const NAV_ITEMS = [
  { href: "/",           label: "Dashboard",  icon: "📊" },
  { href: "/orders",     label: "Pesanan",    icon: "📋" },
  { href: "/warehouse",  label: "Gudang",     icon: "🏭" },
  { href: "/products",   label: "Produk",     icon: "📦" },
  { href: "/categories", label: "Kategori",   icon: "🗂️" },
  { href: "/vouchers",   label: "Voucher",    icon: "🎟️" },
];

export default function AdminRoot() {
  const location = useLocation();
  if (location.pathname === "/login") {
    return (
      <html lang="id">
        <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><Meta /><Links /></head>
        <body><Outlet /><ScrollRestoration /><Scripts /></body>
      </html>
    );
  }

  return (
    <html lang="id">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-gray-100 min-h-screen flex">
        {/* Sidebar */}
        <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0 fixed h-full">
          <div className="px-5 py-4 border-b border-gray-700">
            <p className="font-bold text-lg">🛒 Admin Panel</p>
          </div>
          <nav className="flex-1 py-4">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                to={item.href}
                className={`flex items-center gap-3 px-5 py-3 text-sm transition-colors ${
                  location.pathname === item.href || (item.href !== "/" && location.pathname.startsWith(item.href))
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-gray-800"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="px-5 py-4 border-t border-gray-700">
            <form method="post" action="/logout">
              <button type="submit" className="text-gray-400 hover:text-white text-sm">
                Keluar
              </button>
            </form>
          </div>
        </aside>

        {/* Main */}
        <main className="ml-56 flex-1 p-6 min-h-screen">
          <Outlet />
        </main>

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
