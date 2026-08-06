import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "@remix-run/react";
import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import stylesheet from "./tailwind.css?url";
import { API_BASE } from "~/lib/config";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: stylesheet }];

// Kategori + jumlah item cart dipakai di header & bottom nav setiap halaman —
// diambil sekali di root loader supaya tidak setiap route fetch sendiri-sendiri.
export async function loader({ request }: LoaderFunctionArgs) {
  const cartId = request.headers.get("Cookie")?.match(/cartId=([^;]+)/)?.[1];

  const [categoriesRes, cartRes] = await Promise.all([
    fetch(`${API_BASE}/api/catalog/categories`),
    cartId ? fetch(`${API_BASE}/api/cart`, { headers: { "X-Cart-Id": cartId } }) : Promise.resolve(null),
  ]);

  const categoriesBody = await categoriesRes.json() as any;
  const cartBody = cartRes ? await cartRes.json() as any : null;

  return json({
    categories:    categoriesBody.success ? categoriesBody.data : [],
    cartItemCount: cartBody?.data?.itemCount ?? 0,
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
