import { Hono } from "hono";
import type { Env } from "../types/env";
import { requireAdmin } from "../middleware/auth";
import { createD1Client } from "@repo/db";
import { orders, shipments, products } from "@repo/db/schema";
import { eq, desc, like, and, sql, count } from "drizzle-orm";
import { createId } from "@repo/db";
import { paginationSchema } from "@repo/shared";

export const adminRouter = new Hono<{ Bindings: Env }>();

const SALES_STATUSES = ["paid", "processing", "packed", "shipped", "delivered", "completed"];
const DAY_LABELS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]; // getUTCDay(): 0=Minggu

// WIB (UTC+7): geser dulu baru format sebagai UTC — trik umum untuk dapat
// "tanggal kalender lokal" tanpa library timezone.
function wibDateKey(offsetDays: number): string {
  const ms = Date.now() + 7 * 60 * 60 * 1000 - offsetDays * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function pctChange(today: number, yesterday: number): number {
  if (yesterday === 0) return today > 0 ? 100 : 0;
  return Math.round(((today - yesterday) / yesterday) * 1000) / 10;
}

// ─── GET /api/admin/stats/overview ─────────────────────────────────────────────
// Statistik dashboard — semua dihitung dari data D1 asli (bukan angka contoh):
// penjualan/pesanan/pelanggan baru hari ini + tren vs kemarin, dan pendapatan
// 7 hari terakhir untuk grafik. Zona waktu WIB (UTC+7).
adminRouter.get("/stats/overview", requireAdmin, async (c) => {
  const boundaryEpoch = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;

  const ordersResult = await c.env.DB.prepare(`
    SELECT
      date(created_at, 'unixepoch', '+7 hours') as day,
      SUM(CASE WHEN status IN (${SALES_STATUSES.map(() => "?").join(",")}) THEN total ELSE 0 END) as revenue,
      COUNT(*) as orderCount
    FROM orders
    WHERE created_at >= ?
    GROUP BY day
  `).bind(...SALES_STATUSES, boundaryEpoch).all<{ day: string; revenue: number; orderCount: number }>();

  const customersResult = await c.env.DB.prepare(`
    SELECT date(created_at, 'unixepoch', '+7 hours') as day, COUNT(*) as count
    FROM users
    WHERE role = 'customer' AND is_guest = 0 AND created_at >= ?
    GROUP BY day
  `).bind(boundaryEpoch).all<{ day: string; count: number }>();

  const ordersByDay    = new Map(ordersResult.results.map(r => [r.day, r]));
  const customersByDay = new Map(customersResult.results.map(r => [r.day, r.count]));

  const todayKey     = wibDateKey(0);
  const yesterdayKey = wibDateKey(1);

  const todaySales      = ordersByDay.get(todayKey)?.revenue ?? 0;
  const yesterdaySales  = ordersByDay.get(yesterdayKey)?.revenue ?? 0;
  const todayOrders     = ordersByDay.get(todayKey)?.orderCount ?? 0;
  const yesterdayOrders = ordersByDay.get(yesterdayKey)?.orderCount ?? 0;
  const todayCustomers     = customersByDay.get(todayKey) ?? 0;
  const yesterdayCustomers = customersByDay.get(yesterdayKey) ?? 0;

  const weeklyRevenue = Array.from({ length: 7 }, (_, i) => {
    const key  = wibDateKey(6 - i); // dari 6 hari lalu ke hari ini
    const date = new Date(`${key}T00:00:00Z`);
    return { date: key, label: DAY_LABELS[date.getUTCDay()], revenue: ordersByDay.get(key)?.revenue ?? 0 };
  });

  return c.json({
    success: true,
    data: {
      totalSalesToday:      todaySales,
      totalSalesTrendPct:   pctChange(todaySales, yesterdaySales),
      newOrdersToday:       todayOrders,
      newOrdersTrendPct:    pctChange(todayOrders, yesterdayOrders),
      newCustomersToday:    todayCustomers,
      newCustomersTrendPct: pctChange(todayCustomers, yesterdayCustomers),
      weeklyRevenue,
    },
  });
});

// ─── GET /api/admin/products ───────────────────────────────────────────────────
// Beda dari GET /api/catalog/products (publik, cuma status "active") — ini
// menampilkan semua status (draft/active/archived) untuk dikelola admin.
adminRouter.get("/products", requireAdmin, async (c) => {
  const { page, limit } = paginationSchema.parse(c.req.query());
  const { search, status } = c.req.query();

  const db    = createD1Client(c.env.DB);
  const conds = [];
  if (status) conds.push(eq(products.status, status as any));
  if (search) conds.push(like(products.name, `%${search}%`));
  const where = conds.length ? and(...conds) : undefined;

  const [rows, countRows] = await Promise.all([
    db.query.products.findMany({
      where, with: { category: true },
      orderBy: [desc(products.createdAt)],
      limit, offset: (page - 1) * limit,
    }),
    db.select({ total: count() }).from(products).where(where),
  ]);

  return c.json({ success: true, data: rows, meta: { page, limit, total: countRows[0]?.total ?? 0 } });
});

// ─── GET /api/admin/products/:id ───────────────────────────────────────────────
adminRouter.get("/products/:id", requireAdmin, async (c) => {
  const db      = createD1Client(c.env.DB);
  const product = await db.query.products.findFirst({
    where: eq(products.id, c.req.param("id")),
    with:  { category: true, variants: true },
  });
  if (!product) return c.json({ success: false, error: "Produk tidak ditemukan" }, 404);
  return c.json({ success: true, data: product });
});

// ─── GET /api/admin/orders ────────────────────────────────────────────────────
adminRouter.get("/orders", requireAdmin, async (c) => {
  const { page, limit } = paginationSchema.parse(c.req.query());
  const { status, search } = c.req.query();

  const db   = createD1Client(c.env.DB);
  const conds = [];
  if (status) conds.push(eq(orders.status, status as any));
  if (search) conds.push(like(orders.orderNo, `%${search}%`));

  const where = conds.length ? and(...conds) : undefined;

  const [rows, countRows] = await Promise.all([
    db.query.orders.findMany({
      where,
      with:    { items: true, payments: true, shipments: true },
      orderBy: [desc(orders.createdAt)],
      limit,
      offset:  (page - 1) * limit,
    }),
    db.select({ total: count() }).from(orders).where(where),
  ]);

  return c.json({ success: true, data: rows, meta: { page, limit, total: countRows[0]?.total ?? 0 } });
});

// ─── GET /api/admin/orders/:id ────────────────────────────────────────────────
adminRouter.get("/orders/:id", requireAdmin, async (c) => {
  const db    = createD1Client(c.env.DB);
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, c.req.param("id")),
    with:  { items: true, payments: true, shipments: true },
  });
  if (!order) return c.json({ success: false, error: "Pesanan tidak ditemukan" }, 404);
  return c.json({ success: true, data: order });
});

// ─── PATCH /api/admin/orders/:id/status ───────────────────────────────────────
adminRouter.patch("/orders/:id/status", requireAdmin, async (c) => {
  const { status, note } = await c.req.json<{ status: string; note?: string }>();
  const db = createD1Client(c.env.DB);

  await db.update(orders)
    .set({ status: status as any, adminNote: note, updatedAt: new Date() })
    .where(eq(orders.id, c.req.param("id")));

  return c.json({ success: true });
});

// ─── POST /api/admin/orders/:id/shipment ──────────────────────────────────────
adminRouter.post("/orders/:id/shipment", requireAdmin, async (c) => {
  const { warehouseId, courier, service, etd, cost, trackingNo } =
    await c.req.json<{
      warehouseId: string; courier: string; service: string;
      etd: string; cost: number; trackingNo?: string;
    }>();

  const db = createD1Client(c.env.DB);
  const shipmentId = createId();

  await db.insert(shipments).values({
    id:          shipmentId,
    orderId:     c.req.param("id"),
    warehouseId, courier, service, etd, cost,
    trackingNo:  trackingNo ?? null,
    status:      "waiting_pickup",
  });

  if (trackingNo) {
    await db.update(orders)
      .set({ status: "shipped", updatedAt: new Date() })
      .where(eq(orders.id, c.req.param("id")));

    // Enqueue resi polling
    await c.env.RESI_POLL_QUEUE.send({ type: "shipment_created", shipmentId, trackingNo, courier });
  }

  return c.json({ success: true, data: { shipmentId } }, 201);
});
