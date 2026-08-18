import type { Env } from "../types/env";
import type { ResiStatus } from "@repo/shared";
import { trackingProviderFor } from "@repo/shared";

// ─── Pelacakan Resi ───────────────────────────────────────────────────────────
// Satu-satunya jalur cek resi. Sebelumnya Binderbyte dipanggil di DUA tempat
// dengan kode terpisah — rute GET /api/shipping/resi dan cron resi-poller —
// sehingga perbaikan di satu sisi tidak pernah sampai ke sisi lain. Yang di
// poller bahkan tidak pernah membaca cache KV yang ditulisnya sendiri.
//
// ─── Kenapa dua provider ──────────────────────────────────────────────────────
// RajaOngkir bisa melacak 11 kurir dan itu sudah termasuk paket gratis, jadi
// dicoba lebih dulu. Tapi daftar kurir yang bisa DILACAK di sana berbeda dari
// yang bisa dihitung TARIFNYA — SiCepat punya tarif tapi tidak bisa dilacak.
//
// Tanpa cadangan, pembeli SiCepat membayar lalu pesanannya tidak pernah
// terlacak: cron tetap jalan, tidak ada error, status diam selamanya. Karena itu
// kurir di luar cakupan RajaOngkir jatuh ke Binderbyte yang berbayar
// (15 credit ≈ Rp 15 per cek).
//
// ─── Kenapa ada jaring pengaman ───────────────────────────────────────────────
// Bentuk respons SUKSES dari track/waybill belum pernah terlihat: empat resi
// sungguhan yang diuji semuanya dijawab "Invalid Awb", jadi parser di bawah
// ditulis dari struktur yang masuk akal, bukan dari contoh nyata.
//
// Menebak nama field lalu memakainya diam-diam itu berbahaya — kalau meleset,
// status pengiriman tidak pernah berubah dan tidak ada error yang muncul.
// Karena itu parser di sini WAJIB bisa bilang "saya tidak mengerti ini", dan
// ketika itu terjadi, bentuknya dicatat ke log lalu pelacakan jatuh ke
// Binderbyte. Konsekuensi terburuk dari tebakan yang salah jadi sekadar biaya
// seperti hari ini, bukan data yang salah.
//
// Log itu memuat NAMA FIELD saja, bukan isinya — cukup untuk membetulkan parser,
// tanpa menumpahkan alamat penerima ke log.

const TIMEOUT_MS = 8_000;

export type ParseResult =
  | { ok: true;  status: ResiStatus }
  | { ok: false; reason: "kosong" }                    // resi belum ada di sistem kurir
  | { ok: false; reason: "tak-dikenal"; shape: string }; // ada isinya, tapi tidak terbaca

export async function trackWaybill(
  env: Env,
  trackingNo: string,
  courier?: string | null,
): Promise<ResiStatus | null> {
  if (trackingProviderFor(courier) === "binderbyte") {
    return fetchBinderbyteTracking(env, trackingNo, courier);
  }

  try {
    const hasil = await fetchRajaOngkirTracking(env, trackingNo, courier!);

    if (hasil.ok) return hasil.status;

    // Resi yang belum terdaftar di sistem kurir adalah keadaan wajar untuk resi
    // yang baru dibuat — bukan alasan membayar Binderbyte untuk jawaban yang
    // sama.
    if (hasil.reason === "kosong") return null;

    console.error(
      `[resi] RajaOngkir menjawab sukses tapi bentuknya tidak dikenali ` +
      `(kurir ${courier}). Struktur: ${hasil.shape}. ` +
      `Jatuh ke Binderbyte — betulkan parseRajaOngkirTracking memakai struktur di atas.`,
    );
  } catch (err) {
    console.error(`[resi] RajaOngkir gagal untuk ${courier}, jatuh ke Binderbyte:`, err);
  }

  return fetchBinderbyteTracking(env, trackingNo, courier);
}

// ─── RajaOngkir ───────────────────────────────────────────────────────────────
// Gratis di paket Starter — sudah dipastikan endpoint-nya terbuka di sana: resi
// karangan ditolak dengan "Invalid Awb" (404), bukan dengan penolakan paket.
export async function fetchRajaOngkirTracking(
  env: Env,
  trackingNo: string,
  courier: string,
): Promise<ParseResult> {
  const key = env.RAJAONGKIR_API_KEY?.trim();
  if (!key) throw new Error("RAJAONGKIR_API_KEY belum diset — resi tidak bisa dilacak.");

  const res = await fetch("https://rajaongkir.komerce.id/api/v1/track/waybill", {
    method:  "POST",
    headers: { key, "content-type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({ awb: trackingNo, courier: courier.toLowerCase() }).toString(),
    signal:  AbortSignal.timeout(TIMEOUT_MS),
  });

  const json = await res.json().catch(() => null);

  if (res.status === 404) return { ok: false, reason: "kosong" };
  if (!res.ok) {
    throw new Error(`RajaOngkir tracking: ${(json as any)?.meta?.message ?? `HTTP ${res.status}`}`);
  }

  return parseRajaOngkirTracking(trackingNo, courier, json);
}

// Nama field dicoba beberapa kemungkinan karena bentuk pastinya belum
// terverifikasi. Yang penting bukan menebak dengan benar sekali jalan, melainkan
// TAHU kapan tebakannya meleset — itulah gunanya cabang "tak-dikenal".
export function parseRajaOngkirTracking(
  trackingNo: string,
  courier: string,
  json: unknown,
): ParseResult {
  const data = (json as { data?: Record<string, unknown> | null })?.data;
  if (!data || typeof data !== "object") return { ok: false, reason: "kosong" };

  const summary = (data.summary ?? data.detail ?? data.delivery_status ?? {}) as Record<string, unknown>;
  const riwayat = (data.manifest ?? data.history ?? data.tracking_history ?? []) as unknown;

  const status = String(
    summary.status ?? summary.pod_status ?? (data as any).status ?? "",
  ).trim();

  // Isinya ada tapi status tidak ketemu = tebakan nama field meleset. Ini yang
  // harus terdengar, bukan diam-diam jadi "tidak ada pembaruan".
  if (!status) return { ok: false, reason: "tak-dikenal", shape: describeShape(data) };

  const baris = Array.isArray(riwayat) ? riwayat as Array<Record<string, unknown>> : [];

  return {
    ok: true,
    status: {
      trackingNo,
      courier,
      status,
      history: baris.map(h => ({
        date:        String(h.manifest_date ?? h.date ?? h.event_date ?? ""),
        description: String(h.manifest_description ?? h.desc ?? h.description ?? h.event ?? ""),
        location:    firstString(h.city_name, h.location, h.manifest_city),
      })),
    },
  };
}

function firstString(...v: unknown[]): string | undefined {
  for (const x of v) if (typeof x === "string" && x.trim()) return x;
  return undefined;
}

// Menggambarkan STRUKTUR sebuah objek — nama field dan tipenya, tanpa isinya.
// Dipakai saat parser tidak mengenali respons: cukup untuk membetulkan kode,
// tanpa menumpahkan nama dan alamat penerima ke log.
export function describeShape(v: unknown, depth = 0): string {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    return v.length === 0 ? "[]" : `[${depth >= 2 ? "…" : describeShape(v[0], depth + 1)} ×${v.length}]`;
  }
  if (typeof v !== "object") return typeof v;
  if (depth >= 3) return "{…}";

  const isi = Object.entries(v as Record<string, unknown>)
    .slice(0, 20)
    .map(([k, val]) => `${k}:${describeShape(val, depth + 1)}`)
    .join(", ");
  return `{${isi}}`;
}

// ─── Binderbyte ───────────────────────────────────────────────────────────────
// Berbayar (15 credit ≈ Rp 15 per cek), dipakai untuk kurir di luar cakupan
// RajaOngkir dan sebagai jaring pengaman. Dipindahkan dari routes/shipping.ts,
// yang punya salinan terpisah dari milik cron.
export async function fetchBinderbyteTracking(
  env: Env,
  trackingNo: string,
  courier?: string | null,
): Promise<ResiStatus | null> {
  const key = env.BINDERBYTE_API_KEY?.trim();
  if (!key) throw new Error("BINDERBYTE_API_KEY belum diset — resi kurir ini tidak bisa dilacak.");

  const params = new URLSearchParams({
    api_key: key,
    courier: courier ?? "auto",
    awb:     trackingNo,
  });

  const res  = await fetch(`https://api.binderbyte.com/v1/track?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null) as {
    status?: number;
    data?: {
      summary: { courier_code: string; status: string };
      history: Array<{ date: string; desc: string; location?: string }>;
    };
  } | null;

  if (!json || json.status !== 200 || !json.data) return null;

  return {
    trackingNo,
    courier: json.data.summary.courier_code,
    status:  json.data.summary.status,
    history: (json.data.history ?? []).map(h => ({
      date:        h.date,
      description: h.desc,
      location:    h.location,
    })),
  };
}

// Status "sudah diterima" ditulis berbeda-beda tiap kurir dan tiap provider.
// Dipusatkan supaya poller dan rute menilainya dengan aturan yang sama — salah
// menilai berarti order tidak pernah ditandai selesai, atau sebaliknya ditandai
// selesai padahal masih di jalan.
export function isDelivered(status: string | null | undefined): boolean {
  const s = String(status ?? "").toLowerCase();
  return s.includes("delivered") || s.includes("diterima") || s.includes("terkirim");
}
