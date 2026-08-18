import type { Env } from "../types/env";
import type { ShippingRate, CityOption } from "@repo/shared";
import { KV_KEYS, KV_TTL } from "@repo/shared";

// ─── Tarif Ongkir ─────────────────────────────────────────────────────────────
// Dipakai bersama oleh GET /api/shipping/ongkir (menampilkan pilihan ke pembeli)
// dan POST /api/checkout (menetapkan harga yang benar-benar ditagih).
//
// Keduanya WAJIB memakai sumber yang sama. Sebelumnya checkout tidak menghitung
// apa pun — ia memercayai angka yang dikirim form pembeli — sehingga siapa pun
// bisa menyetel ongkirnya sendiri jadi nol.
//
// ─── Migrasi ke RajaOngkir by Komerce ────────────────────────────────────────
// api.rajaongkir.com sudah MATI — port 443-nya tidak merespons sama sekali,
// bukan sekadar menolak. Selama itu, checkout tidak bisa menghitung ongkir dan
// menolak setiap pesanan.
//
// Tiga hal berubah, dan ketiganya bukan sekadar ganti URL:
//
//   1. Tujuan sekarang level KELURAHAN, bukan kota. ID lama (mis. 152 untuk
//      Jakarta Pusat) tidak berlaku lagi; ID baru berkisar puluhan ribu
//      (mis. 17596 = Cempaka Putih Barat).
//   2. Banyak kurir bisa diminta dalam SATU panggilan, dipisah titik dua.
//      Versi lama memanggil sekali per kurir, jadi menampilkan 17 kurir dulu
//      berarti 17 hit dari kuota 100/hari; sekarang cukup satu.
//   3. Bentuk responsnya datar. Yang lama bersarang tiga tingkat
//      (rajaongkir.results[].costs[].cost[0].value); yang baru langsung
//      { code, name, service, description, cost, etd }.
const BASE_URL = "https://rajaongkir.komerce.id/api/v1";

// Paket Starter yang gratis pun sudah mencakup belasan ekspedisi domestik.
// Daftar ini dulu hanya berisi jne/pos/tiki karena batasan paket Starter LAMA —
// pembeli kehilangan pilihan tanpa alasan. Karena semuanya masuk dalam satu
// panggilan, memperpanjangnya tidak menambah pemakaian kuota sama sekali.
//
// Daftar ini bukan tebakan: API menolak kode tak dikenal dengan HTTP 422 dan
// menyebutkan sendiri yang sah. Satu kode keliru menggugurkan SELURUH
// permintaan, bukan cuma kurir itu — jadi menambah kurir baru harus dicocokkan
// dengan pesan tersebut, bukan dikira-kira.
const ALL_COURIERS = [
  "jne", "sicepat", "ide", "sap", "jnt", "ninja", "tiki", "lion",
  "anteraja", "pos", "ncs", "rex", "rpx", "sentral", "star", "wahana",
];

// ─── Parsing ──────────────────────────────────────────────────────────────────
// Dipisah dari pemanggilan jaringan supaya bentuk respons bisa dikunci test
// tanpa menembak API sungguhan — kuota gratisnya 100 panggilan/hari.

type KomerceEnvelope<T> = { meta?: { message?: string; code?: number; status?: string }; data?: T | null };

export function parseCostResponse(json: unknown): ShippingRate[] {
  const body = json as KomerceEnvelope<Array<Record<string, unknown>>>;
  const rows = Array.isArray(body?.data) ? body.data : [];

  return rows
    .map(r => ({
      courier:     String(r.code ?? ""),
      courierName: String(r.name ?? r.code ?? ""),
      service:     String(r.service ?? ""),
      serviceName: String(r.description ?? r.service ?? ""),
      cost:        Number(r.cost ?? 0),
      etd:         String(r.etd ?? "-").trim() || "-",
    }))
    // Layanan tanpa kurir atau tanpa tarif tidak bisa dipilih pembeli, dan
    // membiarkannya lolos berarti checkout bisa menetapkan ongkir nol.
    .filter(r => r.courier && r.service && r.cost > 0);
}

export function parseDestinationResponse(json: unknown): CityOption[] {
  const body = json as KomerceEnvelope<Array<Record<string, unknown>>>;
  const rows = Array.isArray(body?.data) ? body.data : [];

  return rows.map(r => ({
    cityId:     Number(r.id ?? 0),
    // `label` sudah berupa alamat lengkap siap baca ("CEMPAKA PUTIH BARAT,
    // CEMPAKA PUTIH, JAKARTA PUSAT, DKI JAKARTA, 10520"), jadi dipakai apa
    // adanya — menyusunnya ulang dari potongan hanya menambah cara untuk salah.
    cityName:   String(r.label ?? r.subdistrict_name ?? ""),
    type:       String(r.district_name ?? ""),
    province:   String(r.province_name ?? ""),
    postalCode: String(r.zip_code ?? ""),
  })).filter(c => c.cityId > 0);
}

// Pesan error yang dikembalikan Komerce ada di meta.message; tanpa membacanya,
// kegagalan tarif hanya tampak sebagai "tidak ada pilihan ongkir".
function envelopeError(json: unknown): string | null {
  const meta = (json as KomerceEnvelope<unknown>)?.meta;
  if (!meta) return null;
  const ok = meta.status === "success" || meta.code === 200;
  return ok ? null : (meta.message ?? `HTTP ${meta.code ?? "?"}`);
}

// ─── Pemanggilan ──────────────────────────────────────────────────────────────

// Checkout menunggu panggilan ini, jadi ia tidak boleh menggantung tanpa batas.
// Tanpa timeout, provider yang lambat membuat seluruh proses checkout tertahan
// sampai Worker-nya sendiri menyerah — pembeli hanya melihat halaman diam.
const TIMEOUT_MS = 8_000;

function requireKey(env: Env): string {
  const key = env.RAJAONGKIR_API_KEY?.trim();
  // Gagal cepat dan jelas, bukan menembak API dengan kunci kosong lalu menunggu.
  if (!key) {
    throw new Error(
      "RAJAONGKIR_API_KEY belum diset — ongkir tidak bisa dihitung. " +
      "Ambil di Developer settings pada dashboard collaborator.komerce.id, lalu set lewat " +
      "`wrangler secret put RAJAONGKIR_API_KEY`, atau isi di apps/api/.dev.vars untuk dev lokal.",
    );
  }
  return key;
}

export async function getShippingRates(
  env: Env,
  origin: number,
  destination: number,
  weight: number,
  couriers: string[] = ALL_COURIERS,
): Promise<ShippingRate[]> {
  // Kurir ikut masuk kunci cache: dua permintaan dengan rute sama tapi daftar
  // kurir berbeda menghasilkan pilihan yang berbeda pula, dan sebelumnya yang
  // sempit bisa menimpa yang lengkap.
  const cacheKey = `${KV_KEYS.ongkir(origin, destination, weight)}:${[...couriers].sort().join(",")}`;
  const cached   = await env.CACHE_KV.get(cacheKey);
  if (cached) return JSON.parse(cached) as ShippingRate[];

  const rates = await fetchDomesticCost(env, origin, destination, weight, couriers);

  // Hasil kosong tidak di-cache — kalau tidak, satu kegagalan provider terkunci
  // selama TTL dan checkout ikut tertahan sepanjang itu.
  if (rates.length > 0) {
    await env.CACHE_KV.put(cacheKey, JSON.stringify(rates), { expirationTtl: KV_TTL.ongkir });
  }

  return rates;
}

// Tarif untuk satu kombinasi kurir + layanan. `null` berarti tidak bisa
// diverifikasi — pemanggil harus menolak, bukan jatuh ke nilai dari klien.
export async function resolveShippingRate(
  env: Env,
  args: { origin: number; destination: number; weight: number; courier: string; service: string },
): Promise<ShippingRate | null> {
  const rates = await getShippingRates(env, args.origin, args.destination, args.weight, [args.courier]);

  const match = rates.find(
    r => r.courier.toLowerCase() === args.courier.toLowerCase()
      && r.service.toLowerCase() === args.service.toLowerCase(),
  );

  return match ?? null;
}

export async function fetchDomesticCost(
  env: Env,
  origin: number | string,
  destination: number | string,
  weight: number,
  couriers: string[] = ALL_COURIERS,
): Promise<ShippingRate[]> {
  const res = await fetch(`${BASE_URL}/calculate/domestic-cost`, {
    method:  "POST",
    headers: {
      key:            requireKey(env),
      "content-type": "application/x-www-form-urlencoded",
    },
    // Titik dua, bukan koma — semua kurir dalam satu panggilan, satu hit kuota.
    body: new URLSearchParams({
      origin:      String(origin),
      destination: String(destination),
      weight:      String(weight),
      courier:     couriers.join(":"),
    }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const json = await res.json().catch(() => null);

  // Kegagalan provider harus terlihat pemanggil, bukan berubah jadi daftar
  // kosong yang tidak bisa dibedakan dari "rute ini memang tidak dilayani".
  if (!res.ok) {
    throw new Error(envelopeError(json) ?? `RajaOngkir menolak permintaan (HTTP ${res.status})`);
  }
  const err = envelopeError(json);
  if (err) throw new Error(`RajaOngkir: ${err}`);

  return parseCostResponse(json);
}

// ─── Pencarian tujuan ─────────────────────────────────────────────────────────
// Dulu seluruh daftar kota diunduh sekali lalu disaring di memori — mungkin
// karena jumlahnya cuma ratusan. Sekarang tujuannya sampai level kelurahan
// (puluhan ribu baris), jadi pencariannya diserahkan ke API.
export async function searchDestinations(
  env: Env,
  search: string,
  limit = 20,
): Promise<CityOption[]> {
  const q = search.trim();
  if (q.length < 2) return [];

  const cacheKey = KV_KEYS.destinationSearch(q.toLowerCase(), limit);
  const cached   = await env.CACHE_KV.get(cacheKey);
  if (cached) return JSON.parse(cached) as CityOption[];

  const params = new URLSearchParams({ search: q, limit: String(limit), offset: "0" });
  const res = await fetch(`${BASE_URL}/destination/domestic-destination?${params}`, {
    headers: { key: requireKey(env) },
    signal:  AbortSignal.timeout(TIMEOUT_MS),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(envelopeError(json) ?? `RajaOngkir menolak permintaan tujuan (HTTP ${res.status})`);
  }
  const err = envelopeError(json);
  if (err) throw new Error(`RajaOngkir: ${err}`);

  const hasil = parseDestinationResponse(json);

  if (hasil.length > 0) {
    await env.CACHE_KV.put(cacheKey, JSON.stringify(hasil), { expirationTtl: KV_TTL.cities });
  }

  return hasil;
}
