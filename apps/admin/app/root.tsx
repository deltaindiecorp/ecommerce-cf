import { Links, Meta, Outlet, Scripts, ScrollRestoration, Link, useLocation, useLoaderData } from "@remix-run/react";
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

function getInitials(name?: string | null): string {
  if (!name) return "AD";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

export default function AdminRoot() {
  const location = useLocation();
  const data = useLoaderData<typeof loader>();

  if (location.pathname === "/login") {
    return (
      <html lang="id">
        <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><Meta /><Links /></head>
        <body><Outlet /><ScrollRestoration /><Scripts /></body>
      </html>
    );
  }

  const user = (data as { user?: { name?: string; role?: string } }).user;

  return (
    <html lang="id">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-gray-50 min-h-screen flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white flex flex-col shrink-0 fixed h-full border-r border-gray-200 p-4 gap-4">
          <div className="flex items-center gap-3 pb-3 border-b border-gray-200">
            <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
              {getInitials(user?.name)}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-gray-800 text-sm truncate">{user?.name ?? "Admin"}</p>
              <p className="text-xs text-gray-400 capitalize">{user?.role ?? "admin"}</p>
            </div>
          </div>

          <nav className="flex flex-col gap-1 flex-1 mt-2">
            {NAV_ITEMS.map(item => {
              const isActive = location.pathname === item.href || (item.href !== "/" && location.pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    isActive ? "bg-blue-50 text-blue-700 font-semibold" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-gray-200 pt-4">
            <form method="post" action="/logout">
              <button
                type="submit"
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                <span>🚪</span>
                Keluar
              </button>
            </form>
          </div>
        </aside>

        {/* Main */}
        <main className="ml-64 flex-1 p-6 min-h-screen">
          <Outlet />
        </main>

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
