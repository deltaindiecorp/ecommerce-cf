import {
  Links, Meta, Outlet, Scripts, ScrollRestoration, Link,
  isRouteErrorResponse, useRouteError,
} from "@remix-run/react";
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import stylesheet from "./tailwind.css?url";
import { apiFetch } from "~/lib/api";
import { FALLBACK_STORE_NAME } from "~/lib/meta";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: stylesheet }];

// Judul bawaan untuk halaman yang tidak punya `meta` sendiri (beranda,
// keranjang, checkout). Route anak yang mengekspor meta akan menimpanya.
export const meta: MetaFunction = ({ data }) =>
  [{ title: (data as { store?: { storeName?: string } } | undefined)?.store?.storeName ?? FALLBACK_STORE_NAME }];

// Kategori + jumlah item cart dipakai di header & bottom nav setiap halaman —
// diambil sekali di root loader supaya tidak setiap route fetch sendiri-sendiri.
export async function loader({ request }: LoaderFunctionArgs) {
  const cartId = request.headers.get("Cookie")?.match(/cartId=([^;]+)/)?.[1];

  const [categoriesBody, cartBody, settingsBody] = await Promise.all([
    apiFetch<any[]>(request, "/api/catalog/categories"),
    cartId
      ? apiFetch<{ itemCount?: number }>(request, "/api/cart", { headers: { "X-Cart-Id": cartId } })
      : Promise.resolve(null),
    apiFetch<any>(request, "/api/settings"),
  ]);

  return json({
    categories:    categoriesBody.data ?? [],
    cartItemCount: cartBody?.data?.itemCount ?? 0,
    // Identitas toko datang dari DB, bukan tertanam di komponen — supaya tiap
    // deployment klien bisa memakai mereknya sendiri tanpa menyentuh kode.
    store:         settingsBody.data ?? { storeName: "Deltacommerce" },
  });
}

export default function App() {
  return (
    <html lang="id">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// ─── Error Boundary ───────────────────────────────────────────────────────────
// Storefront sebelumnya tidak punya ini sama sekali. Kegagalan loader apa pun —
// API mati, respons HTML alih-alih JSON — berujung layar error bawaan Remix
// tanpa gaya: halaman putih dengan tumpukan stack untuk calon pembeli.
//
// Nada pesannya sengaja berbeda dari panel admin. Pembeli tidak bisa berbuat
// apa-apa soal API yang mati dan tidak perlu tahu detail teknisnya; yang
// dibutuhkan cuma kepastian bahwa ini bukan salah mereka dan jalan keluarnya.
export function ErrorBoundary() {
  const error = useRouteError();

  let title  = "Ada gangguan sesaat";
  let detail = "Kami sedang memperbaikinya. Coba muat ulang beberapa saat lagi.";

  if (isRouteErrorResponse(error) && error.status === 404) {
    title  = "Halaman tidak ditemukan";
    detail = "Halaman yang Anda cari tidak ada atau sudah dipindahkan.";
  }

  return (
    <html lang="id">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <Meta />
        <Links />
      </head>
      <body className="bg-gray-50">
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md w-full p-8 text-center">
            <p className="text-4xl mb-4">🛠️</p>
            <h1 className="text-xl font-bold text-gray-800 mb-2">{title}</h1>
            <p className="text-sm text-gray-600 mb-6">{detail}</p>
            <Link
              to="/"
              className="inline-block bg-blue-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-blue-700"
            >
              Kembali ke Beranda
            </Link>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
