import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { redirect } from "@remix-run/cloudflare";

import { API_BASE } from "~/lib/config";
import { getAuthToken, clearedAuthCookie } from "~/lib/session";

// Sebelumnya pelanggan sama sekali tidak bisa keluar — tidak ada route-nya.
// Di perangkat bersama, satu-satunya cara mengakhiri sesi adalah menunggu
// tokennya kedaluwarsa tujuh hari kemudian.
export async function action({ request }: ActionFunctionArgs) {
  const token = getAuthToken(request);

  // Cabut di server, bukan sekadar hapus cookie. Kegagalannya tidak boleh
  // menahan pengguna tetap masuk, jadi ditelan — cookie tetap dihapus.
  if (token) {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
  }

  return redirect("/", { headers: { "Set-Cookie": clearedAuthCookie() } });
}

export async function loader() {
  return redirect("/");
}
