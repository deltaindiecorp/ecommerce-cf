import { Hono } from "hono";
import type { Env } from "../types/env";
import { KV_KEYS, KV_TTL } from "@repo/shared";
import { getShippingRates, getAllRajaOngkirCities } from "../services/shipping";
import type { ShippingRate, ResiStatus, CityOption } from "@repo/shared";
import { createD1Client } from "@repo/db";
import { shipments, warehouses } from "@repo/db/schema";
import { eq } from "drizzle-orm";

export const shippingRouter = new Hono<{ Bindings: Env }>();

// ─── GET /api/shipping/origin ─────────────────────────────────────────────────
// Publik — dipakai storefront untuk isi `origin` saat cek ongkir sebelum checkout
// (gudang final baru ditentukan saat checkout lewat warehouse routing).
shippingRouter.get("/origin", async (c) => {
  const db = createD1Client(c.env.DB);
  const wh = await db.select().from(warehouses)
    .where(eq(warehouses.isActive, true))
    .orderBy(warehouses.priority)
    .limit(1)
    .get();

  if (!wh) return c.json({ success: false, error: "Belum ada gudang aktif" }, 404);

  return c.json({
    success: true,
    data: { warehouseId: wh.id, name: wh.name, rajaongkirCityId: wh.rajaongkirCityId },
  });
});

// ─── GET /api/shipping/cities ──────────────────────────────────────────────────
// Autocomplete kota tujuan untuk checkout. RajaOngkir Starter tidak punya
// endpoint search — API-nya cuma kasih SATU daftar kota lengkap (~500 baris),
// jadi kita cache seluruh daftar 24 jam lalu filter di sini (bukan di RajaOngkir).
shippingRouter.get("/cities", async (c) => {
  const { search } = c.req.query();
  if (!search || search.trim().length < 2) {
    return c.json({ success: true, data: [] });
  }

  const cities = await getAllRajaOngkirCities(c.env);
  const query  = search.trim().toLowerCase();

  const matches: CityOption[] = cities
    .filter(city => city.cityName.toLowerCase().includes(query) || city.province.toLowerCase().includes(query))
    .slice(0, 20);

  return c.json({ success: true, data: matches });
});

// ─── GET /api/shipping/ongkir ─────────────────────────────────────────────────
// Query: origin, destination, weight, couriers (optional, comma-separated)
shippingRouter.get("/ongkir", async (c) => {
  const { origin, destination, weight, couriers } = c.req.query();

  if (!origin || !destination || !weight) {
    return c.json({ success: false, error: "origin, destination, weight wajib diisi" }, 400);
  }

  // Sumber tarif yang sama persis dengan yang dipakai checkout untuk menetapkan
  // harga. Kalau keduanya berbeda, pembeli bisa melihat satu angka lalu ditagih
  // angka lain — dan itu justru lebih buruk daripada bug yang diperbaiki di sini.
  const rates = await getShippingRates(
    c.env,
    Number(origin),
    Number(destination),
    Number(weight),
    couriers?.split(",").map(x => x.trim()).filter(Boolean),
  ).catch(() => [] as ShippingRate[]);

  return c.json({
    success: true,
    data:    [...rates].sort((a, b) => a.cost - b.cost),
  });
});

// ─── GET /api/shipping/resi/:no ───────────────────────────────────────────────
shippingRouter.get("/resi/:no", async (c) => {
  const { no }     = c.req.param();
  const { courier } = c.req.query();
  const cacheKey   = KV_KEYS.resi(no);

  const cached = await c.env.CACHE_KV.get(cacheKey);
  if (cached) return c.json({ success: true, data: JSON.parse(cached), cached: true });

  const status = await fetchBinderbyte(c.env, no, courier);
  if (!status)  return c.json({ success: false, error: "Nomor resi tidak ditemukan" }, 404);

  await c.env.CACHE_KV.put(cacheKey, JSON.stringify(status), { expirationTtl: KV_TTL.resi });

  return c.json({ success: true, data: status });
});

// ─── GET /api/shipping/order/:orderId/track ───────────────────────────────────
// Publik - tidak perlu auth
shippingRouter.get("/order/:orderId/track", async (c) => {
  const db       = createD1Client(c.env.DB);
  const shipment = await db.query.shipments.findFirst({
    where: eq(shipments.orderId, c.req.param("orderId")),
  });

  if (!shipment) return c.json({ success: false, error: "Shipment tidak ditemukan" }, 404);

  let resiData: ResiStatus | null = null;
  if (shipment.trackingNo) {
    const cacheKey = KV_KEYS.resi(shipment.trackingNo);
    const cached   = await c.env.CACHE_KV.get(cacheKey);

    resiData = cached
      ? JSON.parse(cached)
      : await fetchBinderbyte(c.env, shipment.trackingNo, shipment.courier);
  }

  return c.json({
    success: true,
    data: {
      orderId:    shipment.orderId,
      courier:    shipment.courier,
      service:    shipment.service,
      trackingNo: shipment.trackingNo,
      status:     shipment.status,
      lastStatus: shipment.lastStatus,
      tracking:   resiData,
    },
  });
});


// ─── RajaOngkir City List Helper (untuk autocomplete) ─────────────────────────

// ─── Binderbyte Cek Resi Helper ───────────────────────────────────────────────
async function fetchBinderbyte(
  env: Env,
  trackingNo: string,
  courier?: string
): Promise<ResiStatus | null> {
  const params = new URLSearchParams({
    api_key: env.BINDERBYTE_API_KEY,
    courier: courier ?? "auto",
    awb:     trackingNo,
  });

  const res  = await fetch(`https://api.binderbyte.com/v1/track?${params}`);
  const json = await res.json() as {
    status:  number;
    message: string;
    data?: {
      summary: { courier_code: string; status: string; awb_date?: string };
      history: Array<{ date: string; desc: string; location?: string }>;
    };
  };

  if (json.status !== 200 || !json.data) return null;

  return {
    trackingNo,
    courier:   json.data.summary.courier_code,
    status:    json.data.summary.status,
    history:   json.data.history.map(h => ({
      date:        h.date,
      description: h.desc,
      location:    h.location,
    })),
  };
}
