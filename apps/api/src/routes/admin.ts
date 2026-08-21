import { Hono } from "hono";
import type { Env } from "../types/env";
import { requireStaff } from "../middleware/auth";
import { createD1Client } from "@repo/db";
import { orders, shipments, products, productVariants, inventory, warehouses, adminAuditLog } from "@repo/db/schema";
import { eq, desc, like, and, sql, count, inArray, sum } from "drizzle-orm";
import { createId } from "@repo/db";
import {
  paginationSchema, isFulfilledStatus, orderStatusUpdateSchema,
  canTransitionOrderStatus, allowedNextStatuses, shipmentInputSchema,
  wibDateKey, SQLITE_WIB_MODIFIER,
} from "@repo/shared";
import { deductOrderStock, releaseOrderStock } from "../services/inventory";
import { logAdminAction } from "../services/audit";

export const adminRouter = new Hono<{ Bindings: Env }>();

// Pembeli terdaftar tidak mengisi kolom guest_*, jadi tanpa relasi ini panel
// admin selalu menampilkan "Customer"/"—" untuk mereka. Kolom disebut eksplisit:
// `user: true` akan ikut mengirim hash password ke browser admin.
const ORDER_USER_COLUMNS = {
  columns: { id: true, name: true, email: true, phone: true },
} as const;

const SALES_STATUSES = ["paid", "processing", "packed", "shipped", "delivered", "completed"];
// Status yang masih masuk akal dibuatkan pengiriman.
const SHIPPABLE_STATUSES = ["paid", "processing", "packed"];
const DAY_LABELS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]; // getUTCDay(): 0=Minggu

function pctChange(today: number, yesterday: number): number {
  if (yesterday === 0) return today > 0 ? 100 : 0;
  return Math.round(((today - yesterday) / yesterday) * 1000) / 10;
}

// ─── GET /api/admin/stats/overview ─────────────────────────────────────────────
// Statistik dashboard — semua dihitung dari data D1 asli (bukan angka contoh):
// penjualan/pesanan/pelanggan baru hari ini + tren vs kemarin, dan pendapatan
// 7 hari terakhir untuk grafik. Zona waktu WIB (UTC+7).
adminRouter.get("/stats/overview", requireStaff, async (c) => {
  const boundaryEpoch = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;

  const ordersResult = await c.env.DB.prepare(`
    SELECT
      date(created_at, 'unixepoch', ?) as day,
      -- subtotal - discount = nilai barang setelah diskon. orders.total ikut
      -- memuat ongkir, yang uang titipan kurir dan bukan pendapatan toko;
      -- memakainya melebih-lebihkan omzet sebesar seluruh ongkir yang tertagih.
      SUM(CASE WHEN status IN (${SALES_STATUSES.map(() => "?").join(",")}) THEN subtotal - discount ELSE 0 END) as revenue,
      COUNT(*) as orderCount
    FROM orders
    WHERE created_at >= ?
    GROUP BY day
  `).bind(SQLITE_WIB_MODIFIER, ...SALES_STATUSES, boundaryEpoch)
    .all<{ day: string; revenue: number; orderCount: number }>();

  // "Pelanggan baru" sebelumnya menghitung baris di tabel users, padahal guest
  // checkout tidak pernah membuat baris user sama sekali. Di toko yang mayoritas
  // transaksinya guest, kartunya menunjukkan nol sementara pesanan terus masuk.
  //
  // Sekarang dihitung dari pembeli: siapa pun yang memesan dalam jendela ini dan
  // TIDAK pernah memesan sebelumnya. Pembeli terdaftar dikenali lewat user_id,
  // guest lewat guest_email — dipisah (bukan COALESCE) supaya NOT EXISTS-nya
  // masih bisa memakai index.
  const customersResult = await c.env.DB.prepare(`
    WITH recent AS (
      SELECT user_id AS uid, guest_email AS gmail, MIN(created_at) AS first_seen
      FROM orders
      WHERE created_at >= ? AND (user_id IS NOT NULL OR guest_email IS NOT NULL)
      GROUP BY user_id, guest_email
    )
    SELECT date(first_seen, 'unixepoch', ?) as day, COUNT(*) as count
    FROM recent r
    WHERE NOT EXISTS (
      SELECT 1 FROM orders o
      WHERE o.created_at < ?
        AND ((r.uid IS NOT NULL AND o.user_id = r.uid)
          OR (r.gmail IS NOT NULL AND o.guest_email = r.gmail))
    )
    GROUP BY day
  `).bind(boundaryEpoch, SQLITE_WIB_MODIFIER, boundaryEpoch)
    .all<{ day: string; count: number }>();

  // Laba kotor dihitung di level item, bukan dari orders.total — total order
  // termasuk ongkir, yang uang titipan kurir dan bukan pendapatan toko.
  //
  // Item yang cost_snapshot-nya NULL (produk belum diisi harga modal saat order
  // dibuat) SENGAJA tidak dianggap bermodal nol; itu akan menampilkan margin
  // 100% palsu. Item semacam itu dikeluarkan dari perhitungan laba dan dihitung
  // terpisah sebagai cakupan, supaya angkanya jujur soal seberapa lengkap.
  const profitResult = await c.env.DB.prepare(`
    SELECT
      date(o.created_at, 'unixepoch', ?) as day,
      SUM(CASE WHEN oi.cost_snapshot IS NOT NULL
               THEN (oi.price_snapshot - oi.cost_snapshot) * oi.qty ELSE 0 END) as grossProfit,
      SUM(CASE WHEN oi.cost_snapshot IS NOT NULL THEN oi.qty ELSE 0 END) as qtyWithCost,
      SUM(oi.qty) as qtyTotal
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at >= ?
      AND o.status IN (${SALES_STATUSES.map(() => "?").join(",")})
    GROUP BY day
  `).bind(SQLITE_WIB_MODIFIER, boundaryEpoch, ...SALES_STATUSES)
    .all<{ day: string; grossProfit: number; qtyWithCost: number; qtyTotal: number }>();

  const ordersByDay    = new Map(ordersResult.results.map(r => [r.day, r]));
  const customersByDay = new Map(customersResult.results.map(r => [r.day, r.count]));
  const profitByDay    = new Map(profitResult.results.map(r => [r.day, r]));

  const todayKey     = wibDateKey(0);
  const yesterdayKey = wibDateKey(1);

  const todaySales      = ordersByDay.get(todayKey)?.revenue ?? 0;
  const yesterdaySales  = ordersByDay.get(yesterdayKey)?.revenue ?? 0;
  const todayOrders     = ordersByDay.get(todayKey)?.orderCount ?? 0;
  const yesterdayOrders = ordersByDay.get(yesterdayKey)?.orderCount ?? 0;
  const todayCustomers     = customersByDay.get(todayKey) ?? 0;
  const yesterdayCustomers = customersByDay.get(yesterdayKey) ?? 0;

  const todayProfit     = profitByDay.get(todayKey)?.grossProfit ?? 0;
  const yesterdayProfit = profitByDay.get(yesterdayKey)?.grossProfit ?? 0;
  const todayQtyTotal    = profitByDay.get(todayKey)?.qtyTotal ?? 0;
  const todayQtyWithCost = profitByDay.get(todayKey)?.qtyWithCost ?? 0;

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
      grossProfitToday:     todayProfit,
      grossProfitTrendPct:  pctChange(todayProfit, yesterdayProfit),
      // 100 saat belum ada penjualan: tidak ada yang tidak tercakup, jadi tidak
      // ada peringatan yang perlu ditampilkan.
      profitCoveragePct:    todayQtyTotal === 0 ? 100 : Math.round((todayQtyWithCost / todayQtyTotal) * 100),
      weeklyRevenue,
    },
  });
});

// ─── GET /api/admin/audit ─────────────────────────────────────────────────────
// Riwayat aksi admin. Dibuat bersama pencatatannya, bukan menyusul — jejak
// audit yang tidak bisa dibaca sama saja tidak ada, kesalahan yang sudah pernah
// terjadi pada inventory_movements.
//
// Query `targetType` + `targetId` memberi riwayat satu objek (mis. semua aksi
// pada satu order); tanpa keduanya jadi feed global terbaru.
adminRouter.get("/audit", requireStaff, async (c) => {
  const { page, limit } = paginationSchema.parse(c.req.query());
  const { targetType, targetId, action } = c.req.query();

  const db    = createD1Client(c.env.DB);
  const conds = [];
  if (targetType) conds.push(eq(adminAuditLog.targetType, targetType));
  if (targetId)   conds.push(eq(adminAuditLog.targetId, targetId));
  if (action)     conds.push(eq(adminAuditLog.action, action));
  const where = conds.length ? and(...conds) : undefined;

  const [rows, countRows] = await Promise.all([
    db.select().from(adminAuditLog)
      .where(where)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(limit).offset((page - 1) * limit),
    db.select({ total: count() }).from(adminAuditLog).where(where),
  ]);

  return c.json({ success: true, data: rows, meta: { page, limit, total: countRows[0]?.total ?? 0 } });
});

// ─── GET /api/admin/products ───────────────────────────────────────────────────
// Beda dari GET /api/catalog/products (publik, cuma status "active") — ini
// menampilkan semua status (draft/active/archived) untuk dikelola admin.
adminRouter.get("/products", requireStaff, async (c) => {
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

  // Stok dan jumlah varian ikut dikirim supaya daftar produk bisa
  // menampilkannya. Tanpa ini panel admin tidak menyebut stok di mana pun
  // kecuali di halaman gudang — tempat yang tidak terpikirkan orang saat
  // pertanyaannya "stok produk ini berapa?".
  //
  // Dua query agregat untuk satu halaman produk, bukan per baris: jumlah
  // barisnya dibatasi `limit`, jadi ini tetap dua round-trip berapa pun
  // panjang halamannya.
  const ids = rows.map(r => r.id);
  const [stokRows, varianRows] = ids.length
    ? await Promise.all([
        db.select({
          productId: inventory.productId,
          onHand:    sum(inventory.qtyOnHand),
          reserved:  sum(inventory.qtyReserved),
        }).from(inventory).where(inArray(inventory.productId, ids)).groupBy(inventory.productId),
        db.select({
          productId: productVariants.productId,
          total:     count(),
        }).from(productVariants).where(inArray(productVariants.productId, ids)).groupBy(productVariants.productId),
      ])
    : [[], []];

  const stokPer   = new Map(stokRows.map(r => [r.productId, r]));
  const varianPer = new Map(varianRows.map(r => [r.productId, Number(r.total ?? 0)]));

  const data = rows.map(r => ({
    ...r,
    stock: {
      onHand:   Number(stokPer.get(r.id)?.onHand ?? 0),
      reserved: Number(stokPer.get(r.id)?.reserved ?? 0),
    },
    variantCount: varianPer.get(r.id) ?? 0,
  }));

  return c.json({ success: true, data, meta: { page, limit, total: countRows[0]?.total ?? 0 } });
});

// ─── GET /api/admin/products/:id ───────────────────────────────────────────────
adminRouter.get("/products/:id", requireStaff, async (c) => {
  const db      = createD1Client(c.env.DB);
  const id      = c.req.param("id");
  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with:  { category: true, variants: true },
  });
  if (!product) return c.json({ success: false, error: "Produk tidak ditemukan" }, 404);

  // Rincian stok per gudang ikut dikirim supaya halaman edit produk bisa
  // menjawab "stok produk ini berapa, di mana" tanpa memaksa orang membuka
  // halaman gudang satu per satu dan mencocokkan sendiri.
  const stok = await db.select({
    warehouseId:   inventory.warehouseId,
    warehouseName: warehouses.name,
    warehouseCode: warehouses.code,
    variantId:     inventory.variantId,
    qtyOnHand:     inventory.qtyOnHand,
    qtyReserved:   inventory.qtyReserved,
  })
    .from(inventory)
    .innerJoin(warehouses, eq(inventory.warehouseId, warehouses.id))
    .where(eq(inventory.productId, id))
    .orderBy(warehouses.priority);

  return c.json({ success: true, data: { ...product, stock: stok } });
});

// ─── GET /api/admin/orders ────────────────────────────────────────────────────
adminRouter.get("/orders", requireStaff, async (c) => {
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
      with:    { items: true, payments: true, shipments: true, user: ORDER_USER_COLUMNS },
      orderBy: [desc(orders.createdAt)],
      limit,
      offset:  (page - 1) * limit,
    }),
    db.select({ total: count() }).from(orders).where(where),
  ]);

  return c.json({ success: true, data: rows, meta: { page, limit, total: countRows[0]?.total ?? 0 } });
});

// ─── GET /api/admin/orders/:id ────────────────────────────────────────────────
adminRouter.get("/orders/:id", requireStaff, async (c) => {
  const db    = createD1Client(c.env.DB);
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, c.req.param("id")),
    with:  { items: true, payments: true, shipments: true, user: ORDER_USER_COLUMNS },
  });
  if (!order) return c.json({ success: false, error: "Pesanan tidak ditemukan" }, 404);
  return c.json({ success: true, data: order });
});

// ─── PATCH /api/admin/orders/:id/status ───────────────────────────────────────
adminRouter.patch("/orders/:id/status", requireStaff, async (c) => {
  const parsed = orderStatusUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const { status, note } = parsed.data;
  const db      = createD1Client(c.env.DB);
  const orderId = c.req.param("id");

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return c.json({ success: false, error: "Pesanan tidak ditemukan" }, 404);

  // Tanpa penjaga ini order bisa melompat sembarangan — termasuk mundur dari
  // status akhir — dan tiap lompatan memicu efek samping stok.
  if (order.status !== status && !canTransitionOrderStatus(order.status, status)) {
    const allowed = allowedNextStatuses(order.status);
    return c.json({
      success: false,
      error: allowed.length
        ? `Status "${order.status}" hanya bisa berpindah ke: ${allowed.join(", ")}.`
        : `Status "${order.status}" sudah final dan tidak bisa diubah lagi.`,
    }, 409);
  }

  await db.update(orders)
    .set({ status, adminNote: note ?? order.adminNote, updatedAt: new Date() })
    .where(eq(orders.id, orderId));

  // Barang keluar gudang begitu order masuk status terpenuhi — konversi
  // reservasi jadi pengurangan stok riil. deductOrderStock idempoten per item,
  // jadi aman kalau status di-set bolak-balik atau jalur lain sudah memotong.
  if (isFulfilledStatus(status)) {
    await deductOrderStock(db, orderId, c.get("userId" as any));
  }

  // Pembatalan lewat panel sebelumnya tidak melepas reservasi sama sekali —
  // hanya jalur webhook pembayaran yang melakukannya — sehingga stok tetap
  // terkunci untuk order yang jelas-jelas sudah batal.
  if (status === "cancelled") {
    await releaseOrderStock(db, orderId, c.get("userId" as any));
  }

  await logAdminAction(db, {
    actorId:    c.get("userId" as any),
    action:     "order.status_changed",
    targetType: "order",
    targetId:   orderId,
    metadata:   { orderNo: order.orderNo, from: order.status, to: status, note: note ?? null },
  });

  return c.json({ success: true });
});

// ─── POST /api/admin/orders/:id/shipment ──────────────────────────────────────
adminRouter.post("/orders/:id/shipment", requireStaff, async (c) => {
  const parsed = shipmentInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const { warehouseId, courier, service, etd, cost, trackingNo } = parsed.data;
  const db      = createD1Client(c.env.DB);
  const orderId = c.req.param("id");

  // Keduanya dipastikan ada sebelum baris shipment dibuat — tanpa ini, id yang
  // salah ketik menghasilkan shipment yang menunjuk entah ke mana, dan order
  // terlanjur berpindah ke "shipped".
  const [order, warehouse] = await Promise.all([
    db.query.orders.findFirst({ where: eq(orders.id, orderId) }),
    db.query.warehouses.findFirst({ where: eq(warehouses.id, warehouseId) }),
  ]);
  if (!order)     return c.json({ success: false, error: "Pesanan tidak ditemukan" }, 404);
  if (!warehouse) return c.json({ success: false, error: "Gudang tidak ditemukan" }, 404);

  // Pengiriman hanya masuk akal untuk order yang sudah dibayar dan belum
  // selesai. Sebelumnya order batal pun bisa dibuatkan resi.
  if (!SHIPPABLE_STATUSES.includes(order.status)) {
    return c.json({
      success: false,
      error: `Pesanan berstatus "${order.status}" tidak bisa dibuatkan pengiriman.`,
    }, 409);
  }

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
      .where(eq(orders.id, orderId));

    // Resi terisi = barang diserahkan ke kurir, stok fisik keluar gudang
    await deductOrderStock(db, orderId, c.get("userId" as any));

    // Enqueue resi polling
    await c.env.RESI_POLL_QUEUE.send({ type: "shipment_created", shipmentId, trackingNo, courier });
  }

  await logAdminAction(db, {
    actorId:    c.get("userId" as any),
    action:     "order.shipment_created",
    targetType: "order",
    targetId:   orderId,
    metadata:   { shipmentId, courier, service, trackingNo: trackingNo ?? null, cost },
  });

  return c.json({ success: true, data: { shipmentId } }, 201);
});
