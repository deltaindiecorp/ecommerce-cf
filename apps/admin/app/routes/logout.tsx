import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { redirect } from "@remix-run/cloudflare";

import { apiFetch } from "~/lib/api";
import { clearedSessionCookie } from "~/lib/session";

export async function action({ request }: ActionFunctionArgs) {
  // Cabut tokennya di server, bukan sekadar hapus cookie di browser. Tanpa ini
  // token yang sudah terlanjur disalin tetap sah sampai kedaluwarsa sendiri.
  // Kegagalannya tidak boleh menahan pengguna di dalam panel, jadi ditelan —
  // cookie tetap dihapus apa pun hasilnya.
  await apiFetch(request, "/api/auth/logout", { method: "POST" }).catch(() => null);

  return redirect("/login", {
    headers: { "Set-Cookie": clearedSessionCookie() },
  });
}

export async function loader() {
  return redirect("/login");
}
