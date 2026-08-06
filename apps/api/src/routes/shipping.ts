import { Hono } from "hono";
import type { Env } from "../types/env";
import { KV_KEYS, KV_TTL } from "@repo/shared";
import type { ShippingRate, ResiStatus } from "@repo/shared";
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

// ─── GET /api/shipping/ongkir ─────────────────────────────────────────────────
// Query: origin, destination, weight, couriers (optional, comma-separated)
shippingRouter.get("/ongkir", async (c) => {
  const { origin, destination, weight, couriers } = c.req.query();

  if (!origin || !destination || !weight) {
    return c.json({ success: false, error: "origin, destination, weight wajib diisi" }, 400);
  }

  const cacheKey = KV_KEYS.ongkir(Number(origin), Number(destination), Number(weight));
  const cached   = await c.env.CACHE_KV.get(cacheKey);
  if (cached) return c.json({ success: true, data: JSON.parse(cached), cached: true });

  const courierList = couriers?.split(",") ?? ["jne", "jnt", "sicepat", "pos", "tiki"];
  const results: ShippingRate[] = [];

  // Fetch ongkir parallel untuk semua kurir
  await Promise.allSettled(courierList.map(async (courier) => {
    const rates = await fetchRajaOngkir(c.env, origin, destination, Number(weight), courier);
    results.push(...rates);
  }));

  // Sort by price
  results.sort((a, b) => a.cost - b.cost);

  await c.env.CACHE_KV.put(cacheKey, JSON.stringify(results), { expirationTtl: KV_TTL.ongkir });

  return c.json({ success: true, data: results });
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

// ─── RajaOngkir Helper ────────────────────────────────────────────────────────
async function fetchRajaOngkir(
  env: Env,
  origin: string,
  destination: string,
  weight: number,
  courier: string
): Promise<ShippingRate[]> {
  const res = await fetch("https://api.rajaongkir.com/starter/cost", {
    method:  "POST",
    headers: {
      key:            env.RAJAONGKIR_API_KEY,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ origin, destination, weight: String(weight), courier }).toString(),
  });

  const json = await res.json() as {
    rajaongkir: {
      results: Array<{
        code: string;
        name: string;
        costs: Array<{ service: string; description: string; cost: Array<{ value: number; etd: string }> }>;
      }>
    }
  };

  const rates: ShippingRate[] = [];
  for (const result of json.rajaongkir?.results ?? []) {
    for (const service of result.costs ?? []) {
      rates.push({
        courier:     result.code,
        courierName: result.name,
        service:     service.service,
        serviceName: service.description,
        cost:        service.cost[0]?.value ?? 0,
        etd:         service.cost[0]?.etd ?? "-",
      });
    }
  }
  return rates;
}

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
