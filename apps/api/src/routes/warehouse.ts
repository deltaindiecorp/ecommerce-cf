import { Hono } from "hono";
import type { Env } from "../types/env";
import { requireAdmin } from "../middleware/auth";
import { createD1Client } from "@repo/db";
import { warehouses, inventory, warehouseTransfers, inventoryMovements } from "@repo/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { createId } from "@repo/db";
import { inventoryAdjustSchema, warehouseInputSchema, warehouseUpdateSchema, warehouseTransferSchema } from "@repo/shared";
import { inventoryRowFilter } from "../services/inventory";

export const warehouseRouter = new Hono<{ Bindings: Env }>();

// ─── GET /api/warehouse ───────────────────────────────────────────────────────
warehouseRouter.get("/", requireAdmin, async (c) => {
  const db   = createD1Client(c.env.DB);
  const rows = await db.select().from(warehouses).orderBy(warehouses.priority);
  return c.json({ success: true, data: rows });
});

// ─── POST /api/warehouse ──────────────────────────────────────────────────────
// Sebelumnya gudang cuma bisa lahir dari seed.sql / SQL manual, jadi tiap klien
// baru butuh intervensi DB sebelum bisa berjualan.
warehouseRouter.post("/", requireAdmin, async (c) => {
  const parsed = warehouseInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const db = createD1Client(c.env.DB);

  const existing = await db.query.warehouses.findFirst({
    where: eq(warehouses.code, parsed.data.code),
  });
  if (existing) return c.json({ success: false, error: `Kode gudang "${parsed.data.code}" sudah dipakai` }, 409);

  const id = createId();
  await db.insert(warehouses).values({ id, ...parsed.data });

  return c.json({ success: true, data: { id } }, 201);
});

// ─── PATCH /api/warehouse/:id ─────────────────────────────────────────────────
warehouseRouter.patch("/:id", requireAdmin, async (c) => {
  const parsed = warehouseUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const db = createD1Client(c.env.DB);
  const id = c.req.param("id");

  const current = await db.query.warehouses.findFirst({ where: eq(warehouses.id, id) });
  if (!current) return c.json({ success: false, error: "Gudang tidak ditemukan" }, 404);

  // Kode gudang unique — cek dulu supaya balasannya jelas, bukan error constraint
  if (parsed.data.code && parsed.data.code !== current.code) {
    const clash = await db.query.warehouses.findFirst({ where: eq(warehouses.code, parsed.data.code) });
    if (clash) return c.json({ success: false, error: `Kode gudang "${parsed.data.code}" sudah dipakai` }, 409);
  }

  await db.update(warehouses).set(parsed.data).where(eq(warehouses.id, id));

  return c.json({ success: true });
});

// ─── DELETE /api/warehouse/:id ────────────────────────────────────────────────
// Soft delete (is_active = false). Hard delete dilarang: inventory, order_items,
// shipments, inventory_movements, dan warehouse_transfers semuanya menunjuk ke
// baris ini — menghapusnya akan memutus histori order. Gudang nonaktif otomatis
// tidak dipakai routing checkout karena difilter eq(isActive, true) di sana.
warehouseRouter.delete("/:id", requireAdmin, async (c) => {
  const db = createD1Client(c.env.DB);
  const id = c.req.param("id");

  const current = await db.query.warehouses.findFirst({ where: eq(warehouses.id, id) });
  if (!current) return c.json({ success: false, error: "Gudang tidak ditemukan" }, 404);

  // Stok tersisa jadi tidak terjangkau kalau gudangnya dimatikan — tolak dan
  // minta admin memindahkannya dulu lewat transfer, daripada diam-diam hilang.
  const leftover = await db.select({ total: sql<number>`COALESCE(SUM(qty_on_hand), 0)` })
    .from(inventory)
    .where(eq(inventory.warehouseId, id));

  const remaining = leftover[0]?.total ?? 0;
  if (remaining > 0) {
    return c.json({
      success: false,
      error: `Gudang masih menyimpan ${remaining} unit stok. Pindahkan dulu lewat transfer sebelum dinonaktifkan.`,
    }, 409);
  }

  await db.update(warehouses).set({ isActive: false }).where(eq(warehouses.id, id));

  return c.json({ success: true });
});

// ─── GET /api/warehouse/:id/inventory ────────────────────────────────────────
warehouseRouter.get("/:id/inventory", requireAdmin, async (c) => {
  const db   = createD1Client(c.env.DB);
  const rows = await db.query.inventory.findMany({
    where: eq(inventory.warehouseId, c.req.param("id")),
    with:  { product: true },
  });
  return c.json({ success: true, data: rows });
});

// ─── POST /api/warehouse/:id/inventory/adjust ─────────────────────────────────
// Stok masuk / koreksi manual (mis. barang baru datang, opname). qty positif =
// tambah, negatif = kurangi. Berbeda dari /transfer yang memindah stok ANTAR gudang.
warehouseRouter.post("/:id/inventory/adjust", requireAdmin, async (c) => {
  const parsed = inventoryAdjustSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const { productId, variantId, qty, note } = parsed.data;
  const warehouseId = c.req.param("id");
  const db = createD1Client(c.env.DB);

  const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.id, warehouseId) });
  if (!wh) return c.json({ success: false, error: "Gudang tidak ditemukan" }, 404);

  // Filter yang sama dengan reserve/release/deduct/transfer. Versi lama
  // menghilangkan kondisi varian saat variantId kosong, sehingga penyesuaian
  // untuk produk tanpa varian bisa mengenai baris varian mana pun.
  const existing = await db.query.inventory.findFirst({
    where: inventoryRowFilter(warehouseId, productId, variantId),
  });

  if (existing) {
    await db.update(inventory)
      .set({
        qtyAvailable: sql`MAX(0, qty_available + ${qty})`,
        qtyOnHand:    sql`MAX(0, qty_on_hand + ${qty})`,
        updatedAt:    new Date(),
      })
      .where(eq(inventory.id, existing.id));
  } else {
    if (qty < 0) return c.json({ success: false, error: "Stok belum ada, tidak bisa dikurangi" }, 400);
    await db.insert(inventory).values({
      id: createId(), warehouseId, productId, variantId: variantId ?? null,
      qtyAvailable: qty, qtyOnHand: qty, qtyReserved: 0,
    });
  }

  await db.insert(inventoryMovements).values({
    id: createId(), warehouseId, productId, variantId: variantId ?? null,
    type:    qty > 0 ? "in" : "adjustment",
    qty:     Math.abs(qty),
    refType: "adjustment",
    note:    note ?? (qty > 0 ? "Stok masuk (admin)" : "Koreksi stok (admin)"),
  });

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// Transfer stok antar gudang
// ═══════════════════════════════════════════════════════════════════════════
//
// Invarian kolom qty yang dipegang seluruh kode ini:
//   qtyOnHand    = barang fisik di rak
//   qtyAvailable = bergerak seiring qtyOnHand (dua kolom ini selalu sejalan)
//   qtyReserved  = sudah dijanjikan tapi belum keluar rak (order + transfer pending)
//   stok bisa dijual = qtyAvailable - qtyReserved
//
// Transfer memakai reservasi dua tahap, sama seperti checkout: saat dibuat, stok
// di gudang asal DIRESERVASI supaya tidak ikut terjual selagi barang menunggu
// dikirim. Baru saat diselesaikan, reservasi itu dikonversi jadi perpindahan
// fisik. Sebelumnya transfer pending tidak mengunci apa pun, sehingga stok yang
// sama bisa terjual ke pembeli di tengah proses.

// ─── POST /api/warehouse/transfer ────────────────────────────────────────────
warehouseRouter.post("/transfer", requireAdmin, async (c) => {
  const parsed = warehouseTransferSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const { fromWarehouse, toWarehouse, productId, variantId, qty, note } = parsed.data;
  const db = createD1Client(c.env.DB);

  const [src, dest] = await Promise.all([
    db.query.warehouses.findFirst({ where: eq(warehouses.id, fromWarehouse) }),
    db.query.warehouses.findFirst({ where: eq(warehouses.id, toWarehouse) }),
  ]);
  if (!src)  return c.json({ success: false, error: "Gudang asal tidak ditemukan" }, 404);
  if (!dest) return c.json({ success: false, error: "Gudang tujuan tidak ditemukan" }, 404);

  const srcInv = await db.query.inventory.findFirst({
    where: inventoryRowFilter(fromWarehouse, productId, variantId),
  });

  const available = (srcInv?.qtyAvailable ?? 0) - (srcInv?.qtyReserved ?? 0);
  if (available < qty) {
    return c.json({ success: false, error: `Stok tidak cukup. Tersedia: ${available}` }, 400);
  }

  const transferId = createId();
  await db.insert(warehouseTransfers).values({
    id: transferId, fromWarehouse, toWarehouse,
    productId, variantId: variantId ?? null,
    qty, status: "pending",
    requestedBy: c.get("userId" as any),
    note: note ?? null,
  });

  // Kunci stoknya selama transfer masih pending
  await db.update(inventory)
    .set({ qtyReserved: sql`qty_reserved + ${qty}`, updatedAt: new Date() })
    .where(inventoryRowFilter(fromWarehouse, productId, variantId));

  await db.insert(inventoryMovements).values({
    id: createId(), warehouseId: fromWarehouse, productId,
    variantId: variantId ?? null, type: "reserve",
    qty, refType: "transfer", refId: transferId,
    note: "Reservasi untuk transfer antar gudang",
  });

  return c.json({ success: true, data: { transferId, status: "pending" } }, 201);
});

// ─── PATCH /api/warehouse/transfer/:id/complete ───────────────────────────────
warehouseRouter.patch("/transfer/:id/complete", requireAdmin, async (c) => {
  const db       = createD1Client(c.env.DB);
  const transfer = await db.query.warehouseTransfers.findFirst({
    where: eq(warehouseTransfers.id, c.req.param("id")),
  });

  if (!transfer || transfer.status !== "pending") {
    return c.json({ success: false, error: "Transfer tidak ditemukan atau sudah selesai" }, 404);
  }

  const { fromWarehouse, toWarehouse, productId, variantId, qty } = transfer;

  // Gudang asal: lepas reservasi DAN kurangi stok fisik. MAX(0, ...) mencegah
  // nilai negatif kalau ada koreksi manual di tengah jalan.
  await db.update(inventory)
    .set({
      qtyReserved:  sql`MAX(0, qty_reserved - ${qty})`,
      qtyAvailable: sql`MAX(0, qty_available - ${qty})`,
      qtyOnHand:    sql`MAX(0, qty_on_hand - ${qty})`,
      updatedAt:    new Date(),
    })
    .where(inventoryRowFilter(fromWarehouse, productId, variantId));

  // Gudang tujuan: upsert baris yang tepat (per varian, bukan per produk)
  const destInv = await db.query.inventory.findFirst({
    where: inventoryRowFilter(toWarehouse, productId, variantId),
  });

  if (destInv) {
    await db.update(inventory)
      .set({
        qtyAvailable: sql`qty_available + ${qty}`,
        qtyOnHand:    sql`qty_on_hand + ${qty}`,
        updatedAt:    new Date(),
      })
      .where(eq(inventory.id, destInv.id));
  } else {
    await db.insert(inventory).values({
      id: createId(), warehouseId: toWarehouse,
      productId, variantId: variantId ?? null,
      qtyAvailable: qty, qtyReserved: 0, qtyOnHand: qty,
    });
  }

  for (const [type, warehouseId] of [
    ["transfer_out", fromWarehouse],
    ["transfer_in",  toWarehouse],
  ] as const) {
    await db.insert(inventoryMovements).values({
      id: createId(), warehouseId, productId,
      variantId: variantId ?? null, type,
      qty, refType: "transfer", refId: transfer.id,
    });
  }

  await db.update(warehouseTransfers)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(warehouseTransfers.id, transfer.id));

  return c.json({ success: true });
});

// ─── PATCH /api/warehouse/transfer/:id/cancel ─────────────────────────────────
// Wajib ada sejak transfer pending mengunci stok: tanpa jalur ini, transfer yang
// batal di dunia nyata akan menahan stoknya selamanya tanpa cara melepas.
warehouseRouter.patch("/transfer/:id/cancel", requireAdmin, async (c) => {
  const db       = createD1Client(c.env.DB);
  const transfer = await db.query.warehouseTransfers.findFirst({
    where: eq(warehouseTransfers.id, c.req.param("id")),
  });

  if (!transfer || transfer.status !== "pending") {
    return c.json({ success: false, error: "Transfer tidak ditemukan atau sudah tidak pending" }, 404);
  }

  const { fromWarehouse, productId, variantId, qty } = transfer;

  await db.update(inventory)
    .set({ qtyReserved: sql`MAX(0, qty_reserved - ${qty})`, updatedAt: new Date() })
    .where(inventoryRowFilter(fromWarehouse, productId, variantId));

  await db.insert(inventoryMovements).values({
    id: createId(), warehouseId: fromWarehouse, productId,
    variantId: variantId ?? null, type: "release",
    qty, refType: "transfer", refId: transfer.id,
    note: "Transfer dibatalkan",
  });

  await db.update(warehouseTransfers)
    .set({ status: "cancelled" })
    .where(eq(warehouseTransfers.id, transfer.id));

  return c.json({ success: true });
});
