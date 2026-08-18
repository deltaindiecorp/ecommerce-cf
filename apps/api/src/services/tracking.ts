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
// dipakai lebih dulu. Tapi daftar kurir yang bisa DILACAK di sana berbeda dari
// yang bisa dihitung TARIFNYA — SiCepat punya tarif tapi tidak bisa dilacak.
//
// Tanpa cadangan, pembeli SiCepat membayar lalu pesanannya tidak pernah
// terlacak: cron tetap jalan, tidak ada error, status diam selamanya. Karena itu
// kurir di luar cakupan RajaOngkir jatuh ke Binderbyte yang berbayar
// (15 credit ≈ Rp 15 per cek).
//
// Pembagiannya ada di `trackingProviderFor` (packages/shared), dipisah supaya
// bisa diuji tanpa jaringan — ia yang menentukan sebuah pengiriman terlacak
// gratis, terlacak berbayar, atau tidak sama sekali.

const TIMEOUT_MS = 8_000;

export async function trackWaybill(
  env: Env,
  trackingNo: string,
  courier?: string | null,
): Promise<ResiStatus | null> {
  const provider = trackingProviderFor(courier);

  if (provider === "rajaongkir") {
    return fetchRajaOngkirTracking(env, trackingNo, courier!);
  }
  return fetchBinderbyteTracking(env, trackingNo, courier);
}

// ─── RajaOngkir ───────────────────────────────────────────────────────────────
// Gratis di paket Starter. Sudah dipastikan endpoint-nya terbuka di sana: resi
// karangan ditolak dengan "Invalid Awb" (404), bukan dengan penolakan paket.
export async function fetchRajaOngkirTracking(
  env: Env,
  trackingNo: string,
  courier: string,
): Promise<ResiStatus | null> {
  const key = env.RAJAONGKIR_API_KEY?.trim();
  if (!key) throw new Error("RAJAONGKIR_API_KEY belum diset — resi tidak bisa dilacak.");

  const res = await fetch("https://rajaongkir.komerce.id/api/v1/track/waybill", {
    method:  "POST",
    headers: { key, "content-type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({ awb: trackingNo, courier: courier.toLowerCase() }).toString(),
    signal:  AbortSignal.timeout(TIMEOUT_MS),
  });

  const json = await res.json().catch(() => null);

  // Resi yang belum terdaftar di sistem kurir dijawab 404 "Invalid Awb". Itu
  // keadaan yang wajar untuk resi yang baru dibuat, bukan kegagalan sistem —
  // jadi null, bukan lempar.
  if (res.status === 404) return null;
  if (!res.ok) {
    const pesan = (json as any)?.meta?.message ?? `HTTP ${res.status}`;
    throw new Error(`RajaOngkir tracking: ${pesan}`);
  }

  return parseRajaOngkirTracking(trackingNo, courier, json);
}

// Dipisah dari pemanggilan jaringan supaya bentuk responsnya bisa dikunci test.
export function parseRajaOngkirTracking(
  trackingNo: string,
  courier: string,
  json: unknown,
): ResiStatus | null {
  const data = (json as { data?: Record<string, unknown> | null })?.data;
  if (!data) return null;

  // Nama field dibaca lentur karena bentuk pastinya baru bisa dipastikan dengan
  // resi sungguhan dari kurir yang didukung; sampai itu terverifikasi, jangan
  // menyempitkannya ke satu nama saja.
  const summary = (data.summary ?? data.detail ?? {}) as Record<string, unknown>;
  const riwayat = (data.manifest ?? data.history ?? []) as Array<Record<string, unknown>>;

  const status = String(summary.status ?? data.status ?? "").trim();
  if (!status) return null;

  return {
    trackingNo,
    courier,
    status,
    history: (Array.isArray(riwayat) ? riwayat : []).map(h => ({
      date:        String(h.manifest_date ?? h.date ?? ""),
      description: String(h.manifest_description ?? h.desc ?? h.description ?? ""),
      location:    h.city_name ? String(h.city_name) : h.location ? String(h.location) : undefined,
    })),
  };
}

// ─── Binderbyte ───────────────────────────────────────────────────────────────
// Berbayar (15 credit ≈ Rp 15 per cek), dipakai hanya untuk kurir yang tidak
// dicakup RajaOngkir. Dipindahkan apa adanya dari routes/shipping.ts.
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
    status?:  number;
    message?: string;
    data?: {
      summary: { courier_code: string; status: string; awb_date?: string };
      history: Array<{ date: string; desc: string; location?: string }>;
    };
  } | null;

  if (!json || json.status !== 200 || !json.data) return null;

  return {
    trackingNo,
    courier:   json.data.summary.courier_code,
    status:    json.data.summary.status,
    history:   (json.data.history ?? []).map(h => ({
      date:        h.date,
      description: h.desc,
      location:    h.location,
    })),
  };
}

// Status "sudah diterima" ditulis berbeda-beda tiap kurir dan tiap provider.
// Dipusatkan di sini supaya poller dan rute menilainya dengan aturan yang sama —
// salah menilai berarti order tidak pernah ditandai selesai, atau sebaliknya
// ditandai selesai padahal masih di jalan.
export function isDelivered(status: string | null | undefined): boolean {
  const s = String(status ?? "").toLowerCase();
  return s.includes("delivered") || s.includes("diterima") || s.includes("terkirim");
}
