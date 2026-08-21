import type { MetaDescriptor } from "@remix-run/cloudflare";

// ─── Judul Halaman ────────────────────────────────────────────────────────────
// Nama toko sebelumnya tertanam di setiap export `meta` ("FAQ - Deltacommerce"),
// jadi mengganti nama lewat panel tidak mengubah judul tab satu halaman pun.
//
// `meta` tidak punya akses ke loader-nya sendiri untuk halaman statis, tapi
// Remix memberi seluruh `matches` — termasuk data loader root, tempat
// pengaturan toko sudah dimuat. Jadi tidak ada permintaan tambahan.

export const FALLBACK_STORE_NAME = "Deltacommerce";

type MatchLike = { id: string; data?: unknown };

export function storeNameFrom(matches: readonly MatchLike[] | undefined): string {
  const root = matches?.find(m => m.id === "root");
  const data = root?.data as { store?: { storeName?: string } } | undefined;
  const name = data?.store?.storeName;
  return typeof name === "string" && name.trim() !== "" ? name : FALLBACK_STORE_NAME;
}

// `pageTitle(matches, "FAQ")` → "FAQ - Nama Toko"
// Tanpa judul halaman, hasilnya nama toko saja — dipakai beranda.
export function pageTitle(matches: readonly MatchLike[] | undefined, page?: string): MetaDescriptor[] {
  const store = storeNameFrom(matches);
  return [{ title: page ? `${page} - ${store}` : store }];
}
