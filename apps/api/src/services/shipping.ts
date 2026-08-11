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

const ALL_COURIERS = ["jne", "pos", "tiki"]; // paket Starter RajaOngkir

export async function getShippingRates(
  env: Env,
  origin: number,
  destination: number,
  weight: number,
  couriers: string[] = ALL_COURIERS,
): Promise<ShippingRate[]> {
  const cacheKey = KV_KEYS.ongkir(origin, destination, weight);
  const cached   = await env.CACHE_KV.get(cacheKey);
  if (cached) return JSON.parse(cached) as ShippingRate[];

  const results = await Promise.all(
    couriers.map(courier =>
      fetchRajaOngkir(env, String(origin), String(destination), weight, courier)
        // Satu kurir bermasalah tidak boleh menggugurkan seluruh pilihan
        .catch(() => [] as ShippingRate[]),
    ),
  );

  const rates = results.flat();

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

// Checkout menunggu panggilan ini, jadi ia tidak boleh menggantung tanpa batas.
// Tanpa timeout, provider yang lambat membuat seluruh proses checkout tertahan
// sampai Worker-nya sendiri menyerah — pembeli hanya melihat halaman diam.
const RAJAONGKIR_TIMEOUT_MS = 8_000;

export async function fetchRajaOngkir(
  env: Env,
  origin: string,
  destination: string,
  weight: number,
  courier: string,
): Promise<ShippingRate[]> {
  // Gagal cepat dan jelas, bukan menembak API dengan kunci kosong lalu menunggu.
  if (!env.RAJAONGKIR_API_KEY?.trim()) {
    throw new Error(
      "RAJAONGKIR_API_KEY belum diset — ongkir tidak bisa dihitung. " +
      "Set lewat `wrangler secret put RAJAONGKIR_API_KEY`, atau isi di apps/api/.dev.vars untuk dev lokal.",
    );
  }

  const res = await fetch("https://api.rajaongkir.com/starter/cost", {
    method:  "POST",
    headers: {
      key:            env.RAJAONGKIR_API_KEY,
      "content-type": "application/x-www-form-urlencoded",
    },
    body:   new URLSearchParams({ origin, destination, weight: String(weight), courier }).toString(),
    signal: AbortSignal.timeout(RAJAONGKIR_TIMEOUT_MS),
  });

  // Kegagalan provider harus terlihat pemanggil, bukan berubah jadi daftar
  // kosong yang tidak bisa dibedakan dari "rute ini memang tidak dilayani".
  if (!res.ok) {
    throw new Error(`RajaOngkir menolak permintaan (HTTP ${res.status})`);
  }

  const json = await res.json() as {
    rajaongkir?: {
      results?: Array<{
        code: string;
        name: string;
        costs?: Array<{ service: string; description: string; cost?: Array<{ value: number; etd: string }> }>;
      }>;
    };
  };

  const rates: ShippingRate[] = [];
  for (const result of json.rajaongkir?.results ?? []) {
    for (const service of result.costs ?? []) {
      rates.push({
        courier:     result.code,
        courierName: result.name,
        service:     service.service,
        serviceName: service.description,
        cost:        service.cost?.[0]?.value ?? 0,
        etd:         service.cost?.[0]?.etd ?? "-",
      });
    }
  }
  return rates;
}

export async function getAllRajaOngkirCities(env: Env): Promise<CityOption[]> {
  const cached = await env.CACHE_KV.get(KV_KEYS.rajaongkirCities);
  if (cached) return JSON.parse(cached) as CityOption[];

  if (!env.RAJAONGKIR_API_KEY?.trim()) {
    throw new Error("RAJAONGKIR_API_KEY belum diset — daftar kota tidak bisa diambil.");
  }

  const res = await fetch("https://api.rajaongkir.com/starter/city", {
    headers: { key: env.RAJAONGKIR_API_KEY },
    signal:  AbortSignal.timeout(RAJAONGKIR_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RajaOngkir menolak permintaan kota (HTTP ${res.status})`);

  const json = await res.json() as {
    rajaongkir?: { results?: Array<{ city_id: string; city_name: string; type: string; province: string; postal_code: string }> };
  };

  const cities: CityOption[] = (json.rajaongkir?.results ?? []).map(r => ({
    cityId:     Number(r.city_id),
    cityName:   r.city_name,
    type:       r.type,
    province:   r.province,
    postalCode: r.postal_code,
  }));

  if (cities.length > 0) {
    await env.CACHE_KV.put(KV_KEYS.rajaongkirCities, JSON.stringify(cities), { expirationTtl: KV_TTL.cities });
  }

  return cities;
}
