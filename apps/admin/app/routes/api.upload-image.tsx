import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";

import { API_BASE } from "~/lib/config";
import { getToken } from "~/lib/api";

// ─── Penerus unggah gambar ────────────────────────────────────────────────────
// Browser tidak bisa mengunggah langsung ke Worker API: tokennya tersimpan di
// cookie HttpOnly (tidak terbaca JavaScript) dan API-nya beda origin. Route ini
// menerima berkasnya di sisi server panel, menempelkan Bearer token, lalu
// meneruskannya.
//
// Berkasnya diteruskan apa adanya — validasi tipe (magic bytes) dan batas 5MB
// tetap ditegakkan API, bukan di sini. Menduplikasi aturannya di dua tempat
// hanya akan membuat keduanya menyimpang.
export async function action({ request }: ActionFunctionArgs) {
  const incoming = await request.formData();
  const file     = incoming.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return json({ success: false, error: "Tidak ada berkas yang dipilih" }, { status: 400 });
  }

  const forward = new FormData();
  forward.append("file", file, file.name);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/upload/product-image`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${getToken(request)}` },
      body:    forward,
    });
  } catch {
    return json({ success: false, error: "Tidak bisa menghubungi API" }, { status: 502 });
  }

  const text = await res.text();
  let body: { success?: boolean; data?: { url?: string }; error?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return json({ success: false, error: `API membalas non-JSON (HTTP ${res.status})` }, { status: 502 });
  }

  if (!res.ok || !body.success) {
    return json({ success: false, error: body.error ?? "Unggah gagal" }, { status: res.status || 400 });
  }

  return json({ success: true, url: body.data?.url ?? "" });
}
