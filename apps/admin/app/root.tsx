import {
  Links, Meta, Outlet, Scripts, ScrollRestoration, Link, useLocation, useLoaderData,
  isRouteErrorResponse, useRouteError,
} from "@remix-run/react";
import type { LoaderFunctionArgs, LinksFunction } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useEffect, useState } from "react";
import stylesheet from "./tailwind.css?url";

import { apiFetch, getToken } from "~/lib/api";
import { PANEL_ROLES } from "~/lib/session";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: stylesheet }];

export async function loader({ request }: LoaderFunctionArgs) {
  const pathname = new URL(request.url).pathname;

  if (pathname === "/login") return json({ authenticated: false });
  if (!getToken(request)) return redirect("/login");

  // apiFetch sudah mengarahkan ke /login untuk 401/403, dan melempar ke
  // ErrorBoundary kalau API mati — dua kondisi yang sebelumnya sama-sama
  // berakhir sebagai redirect diam-diam ke halaman login yang membingungkan.
  const body = await apiFetch<{ role?: string; name?: string }>(request, "/api/auth/me");

  if (!body.success || !PANEL_ROLES.includes(body.data?.role ?? "")) return redirect("/login");

  return json({ authenticated: true, user: body.data });
}

const NAV_ITEMS = [
  { href: "/",           label: "Dashboard",  icon: "📊" },
  { href: "/orders",     label: "Pesanan",    icon: "📋" },
  { href: "/warehouse",  label: "Gudang",     icon: "🏭" },
  { href: "/products",   label: "Produk",     icon: "📦" },
  { href: "/categories", label: "Kategori",   icon: "🗂️" },
  { href: "/vouchers",   label: "Voucher",    icon: "🎟️", adminOnly: true },
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
  // Sidebar hanya bisa ditutup di layar kecil; di lg ke atas selalu terlihat
  // sehingga state ini tidak berpengaruh.
  const [navOpen, setNavOpen] = useState(false);

  // Tutup otomatis setiap pindah halaman — kalau tidak, menu menutupi konten
  // yang baru dibuka di HP.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

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
      <body className="bg-gray-50 min-h-screen">
        {/* Bilah atas — hanya di layar kecil, tempat tombol menu */}
        <header className="lg:hidden fixed inset-x-0 top-0 z-30 h-14 bg-white border-b border-gray-200 flex items-center gap-3 px-4">
          <button
            type="button"
            onClick={() => setNavOpen(v => !v)}
            aria-label={navOpen ? "Tutup menu" : "Buka menu"}
            aria-expanded={navOpen}
            className="w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-700"
          >
            {navOpen ? "✕" : "☰"}
          </button>
          <span className="font-bold text-gray-800 text-sm">Admin</span>
        </header>

        {/* Latar gelap saat menu terbuka di layar kecil */}
        {navOpen && (
          <div
            onClick={() => setNavOpen(false)}
            className="lg:hidden fixed inset-0 z-30 bg-gray-900/40"
            aria-hidden="true"
          />
        )}

        {/* Sidebar — menggeser masuk di layar kecil, tetap di tempat mulai lg */}
        <aside
          className={`w-64 bg-white flex flex-col fixed inset-y-0 left-0 z-40 border-r border-gray-200 p-4 gap-4
            transition-transform duration-200 lg:translate-x-0
            ${navOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
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
            {NAV_ITEMS.filter(item => !item.adminOnly || user?.role === "admin").map(item => {
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

        {/* Main — diberi ruang atas untuk bilah menu di layar kecil */}
        <main className="lg:ml-64 p-4 pt-18 lg:p-6 min-h-screen">
          <Outlet />
        </main>

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// ─── Error Boundary ───────────────────────────────────────────────────────────
// Sebelumnya tidak ada sama sekali, jadi kegagalan loader apa pun — API mati,
// respons HTML alih-alih JSON, bug di route — berujung layar error bawaan Remix
// tanpa gaya dan tanpa petunjuk. Karena ini di root, ia menangkap seluruh route
// dan harus merender dokumen HTML utuh (tree normal sudah diganti).
export function ErrorBoundary() {
  const error = useRouteError();

  let title  = "Terjadi kesalahan";
  let detail = "Kesalahan tak terduga. Coba muat ulang halaman.";
  let hint: string | null = null;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title  = "Halaman tidak ditemukan";
      detail = "Alamat yang dibuka tidak ada di panel admin.";
    } else if (error.status === 502) {
      title  = error.statusText || "API tidak terjangkau";
      detail = typeof error.data === "string" ? error.data : "Panel tidak bisa menghubungi Worker API.";
      hint   = "Cek apakah Worker API berjalan, lalu muat ulang.";
    } else {
      title  = `${error.status} ${error.statusText}`.trim();
      detail = typeof error.data === "string" ? error.data : detail;
    }
  } else if (error instanceof Error) {
    detail = error.message;
  }

  return (
    <html lang="id">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · Admin</title>
        <Meta />
        <Links />
      </head>
      <body className="bg-gray-50 min-h-screen flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-lg w-full p-8">
          <p className="text-3xl mb-3">⚠️</p>
          <h1 className="text-lg font-bold text-gray-800 mb-2">{title}</h1>
          <p className="text-sm text-gray-600 whitespace-pre-wrap break-words">{detail}</p>
          {hint && <p className="text-xs text-gray-400 mt-3">{hint}</p>}

          <div className="flex items-center gap-3 mt-6">
            <Link
              to="/"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              Kembali ke Dashboard
            </Link>
            <Link to="/login" className="text-sm text-gray-500 hover:text-gray-700">
              Masuk ulang
            </Link>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
