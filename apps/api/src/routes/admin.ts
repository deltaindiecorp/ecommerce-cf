import { Hono } from "hono";
import type { Env } from "../types/env";
import { requireAdmin } from "../middleware/auth";
import { createD1Client } from "@repo/db";
import { orders, shipments, products } from "@repo/db/schema";
import { eq, desc, like, and, sql, count } from "drizzle-orm";
import { createId } from "@repo/db";
import { paginationSchema } from "@repo/shared";

export const adminRouter = new Hono<{ Bindings: Env }>();

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
