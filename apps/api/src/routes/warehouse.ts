import { Hono } from "hono";
import type { Env } from "../types/env";
import { requireAdmin, requireStaff } from "../middleware/auth";
import { createD1Client } from "@repo/db";
import { warehouses, inventory, warehouseTransfers, inventoryMovements, products, productVariants, users } from "@repo/db/schema";
import { eq, and, sql, desc, count } from "drizzle-orm";
import { createId } from "@repo/db";
import {
  inventoryAdjustSchema, warehouseInputSchema, warehouseUpdateSchema,
  warehouseTransferSchema, paginationSchema,
} from "@repo/shared";
import { inventoryRowFilter } from "../services/inventory";
import { logAdminAction } from "../services/audit";

export const warehouseRouter = new Hono<{ Bindings: Env }>();

// ─── GET /api/warehouse ───────────────────────────────────────────────────────
warehouseRouter.get("/", requireStaff, async (c) => {
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

  await logAdminAction(db, {
    actorId: c.get("userId" as any), action: "warehouse.created",
    targetType: "warehouse", targetId: id,
    metadata: { name: parsed.data.name, code: parsed.data.code },
  });

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

  await logAdminAction(db, {
    actorId: c.get("userId" as any), action: "warehouse.updated",
    targetType: "warehouse", targetId: id,
    metadata: { name: current.name, changed: Object.keys(parsed.data) },
  });

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

  await logAdminAction(db, {
    actorId: c.get("userId" as any), action: "warehouse.deactivated",
    targetType: "warehouse", targetId: id,
    metadata: { name: current.name, code: current.code },
  });

  return c.json({ success: true });
});

// ─── GET /api/warehouse/:id/inventory ────────────────────────────────────────
warehouseRouter.get("/:id/inventory", requireStaff, async (c) => {
  const db   = createD1Client(c.env.DB);
  const rows = await db.query.inventory.findMany({
    where: eq(inventory.warehouseId, c.req.param("id")),
    with:  { product: true },
  });
  return c.json({ success: true, data: rows });
});

// ─── GET /api/warehouse/:id/movements ────────────────────────────────────────
// Kartu stok. Tabel inventory_movements sudah ditulis rajin sejak awal tapi
// tidak pernah dibaca satu endpoint pun — ledger yang tidak bisa dilihat sama
// saja tidak ada. Ini yang menjawab "kenapa stoknya berubah, kapan, oleh siapa".
warehouseRouter.get("/:id/movements", requireStaff, async (c) => {
  const { page, limit } = paginationSchema.parse(c.req.query());
  const { productId, type } = c.req.query();

  const db          = createD1Client(c.env.DB);
  const warehouseId = c.req.param("id");

  const conds = [eq(inventoryMovements.warehouseId, warehouseId)];
  if (productId) conds.push(eq(inventoryMovements.productId, productId));
  if (type)      conds.push(eq(inventoryMovements.type, type as any));
  const where = and(...conds);

  const [rows, countRows] = await Promise.all([
    db.select({
      id:        inventoryMovements.id,
      type:      inventoryMovements.type,
      qty:       inventoryMovements.qty,
      refType:   inventoryMovements.refType,
      refId:     inventoryMovements.refId,
      note:      inventoryMovements.note,
      createdAt: inventoryMovements.createdAt,
      productId: inventoryMovements.productId,
      variantId: inventoryMovements.variantId,
      productName: products.name,
      variantName: productVariants.name,
      // Nama aktor, bukan sekadar id — kolom ini gunanya justru untuk dibaca
      // manusia saat menelusuri selisih opname.
      actorName:   users.name,
    })
      .from(inventoryMovements)
      .leftJoin(products, eq(products.id, inventoryMovements.productId))
      .leftJoin(productVariants, eq(productVariants.id, inventoryMovements.variantId))
      .leftJoin(users, eq(users.id, inventoryMovements.createdBy))
      .where(where)
      .orderBy(desc(inventoryMovements.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(inventoryMovements).where(where),
  ]);

  return c.json({
    success: true,
    data:    rows,
    meta:    { page, limit, total: countRows[0]?.total ?? 0 },
  });
});

// ─── POST /api/warehouse/:id/inventory/adjust ─────────────────────────────────
// Stok masuk / koreksi manual (mis. barang baru datang, opname). qty positif =
// tambah, negatif = kurangi. Berbeda dari /transfer yang memindah stok ANTAR gudang.
warehouseRouter.post("/:id/inventory/adjust", requireStaff, async (c) => {
  const parsed = inventoryAdjustSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const { productId, variantId, qty, movementType, note } = parsed.data;
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

  if (!existing && qty < 0) {
    return c.json({ success: false, error: "Stok belum ada, tidak bisa dikurangi" }, 400);
  }

  // Perubahan stok dan catatan ledger-nya menyatu. Kalau stok berubah tanpa
  // baris movement, kartu stok jadi bohong: angkanya bergeser tanpa ada
  // penjelasan siapa pun — persis yang paling sulit ditelusuri saat opname.
  //
  // Tipe diambil dari maksud yang dinyatakan admin, bukan disimpulkan dari tanda
  // qty. Barang datang dari supplier dan koreksi opname yang naik dua-duanya
  // positif, tapi artinya berbeda dan laporan stok harus bisa memisahkannya.
  await db.batch([
    existing
      ? db.update(inventory)
          .set({ qtyOnHand: sql`MAX(0, qty_on_hand + ${qty})`, updatedAt: new Date() })
          .where(eq(inventory.id, existing.id))
      : db.insert(inventory).values({
          id: createId(), warehouseId, productId, variantId: variantId ?? null,
          qtyOnHand: qty, qtyReserved: 0,
        }),
    db.insert(inventoryMovements).values({
      id: createId(), warehouseId, productId, variantId: variantId ?? null,
      type:      movementType,
      qty:       Math.abs(qty),
      refType:   "adjustment",
      createdBy: c.get("userId" as any) ?? null,
      note:      note ?? (movementType === "in" ? "Stok masuk" : "Koreksi opname"),
    }),
  ]);

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// Transfer stok antar gudang
// ═══════════════════════════════════════════════════════════════════════════
//
// Invarian kolom qty yang dipegang seluruh kode ini:
//   qtyOnHand   = barang fisik di rak
//   qtyReserved = sudah dijanjikan tapi belum keluar rak (order + transfer pending)
//   bisa dijual = qtyOnHand - qtyReserved
//
// Transfer memakai reservasi dua tahap, sama seperti checkout: saat dibuat, stok
// di gudang asal DIRESERVASI supaya tidak ikut terjual selagi barang menunggu
// dikirim. Baru saat diselesaikan, reservasi itu dikonversi jadi perpindahan
// fisik. Sebelumnya transfer pending tidak mengunci apa pun, sehingga stok yang
// sama bisa terjual ke pembeli di tengah proses.

// ─── POST /api/warehouse/transfer ────────────────────────────────────────────
warehouseRouter.post("/transfer", requireStaff, async (c) => {
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

  const available = (srcInv?.qtyOnHand ?? 0) - (srcInv?.qtyReserved ?? 0);
  if (available < qty) {
    return c.json({ success: false, error: `Stok tidak cukup. Tersedia: ${available}` }, 400);
  }

  const transferId = createId();
  const actorId    = c.get("userId" as any) ?? null;

  // Baris transfer dan penguncian stoknya harus jadi bersamaan. Kalau hanya
  // salah satu yang tertulis: transfer tanpa reservasi berarti stoknya masih
  // bisa terjual, sedangkan reservasi tanpa baris transfer berarti stok
  // terkunci selamanya tanpa ada yang bisa menyelesaikan atau membatalkannya.
  await db.batch([
    db.insert(warehouseTransfers).values({
      id: transferId, fromWarehouse, toWarehouse,
      productId, variantId: variantId ?? null,
      qty, status: "pending",
      requestedBy: actorId,
      note: note ?? null,
    }),
    db.update(inventory)
      .set({ qtyReserved: sql`qty_reserved + ${qty}`, updatedAt: new Date() })
      .where(inventoryRowFilter(fromWarehouse, productId, variantId)),
    db.insert(inventoryMovements).values({
      id: createId(), warehouseId: fromWarehouse, productId,
      variantId: variantId ?? null, type: "reserve",
      qty, refType: "transfer", refId: transferId, createdBy: actorId,
      note: "Reservasi untuk transfer antar gudang",
    }),
  ]);

  return c.json({ success: true, data: { transferId, status: "pending" } }, 201);
});

// ─── PATCH /api/warehouse/transfer/:id/complete ───────────────────────────────
warehouseRouter.patch("/transfer/:id/complete", requireStaff, async (c) => {
  const db       = createD1Client(c.env.DB);
  const transfer = await db.query.warehouseTransfers.findFirst({
    where: eq(warehouseTransfers.id, c.req.param("id")),
  });

  if (!transfer || transfer.status !== "pending") {
    return c.json({ success: false, error: "Transfer tidak ditemukan atau sudah selesai" }, 404);
  }

  const { fromWarehouse, toWarehouse, productId, variantId, qty } = transfer;
  const actorId = c.get("userId" as any) ?? null;

  // Baca dulu untuk memutuskan upsert; ini satu-satunya bagian yang tidak bisa
  // masuk batch karena hasilnya menentukan bentuk penulisannya.
  const destInv = await db.query.inventory.findFirst({
    where: inventoryRowFilter(toWarehouse, productId, variantId),
  });

  // SELURUH penulisan dijalankan sebagai satu transaksi D1.
  //
  // Sebelumnya lima penulisan berurutan dengan status transfer diset di
  // penulisan TERAKHIR. Kalau Worker mati di tengah — dan Worker memang bisa
  // dihentikan kapan saja karena batas CPU atau deploy — hasilnya: stok gudang
  // asal sudah berkurang, gudang tujuan belum bertambah (stok lenyap), status
  // masih "pending" sehingga transfer bisa diulang, dan pengulangannya
  // mengurangi stok asal untuk KEDUA kalinya.
  //
  // Idempotensi tidak menyelesaikan ini: penjaganya justru status transfer,
  // yang ikut gagal tertulis. Yang dibutuhkan atomisitas.
  await db.batch([
    // Gudang asal: lepas reservasi DAN kurangi stok fisik. MAX(0, ...) mencegah
    // nilai negatif kalau ada koreksi manual di tengah jalan.
    db.update(inventory)
      .set({
        qtyReserved: sql`MAX(0, qty_reserved - ${qty})`,
        qtyOnHand:   sql`MAX(0, qty_on_hand - ${qty})`,
        updatedAt:   new Date(),
      })
      .where(inventoryRowFilter(fromWarehouse, productId, variantId)),

    // Gudang tujuan: baris yang tepat (per varian, bukan per produk)
    destInv
      ? db.update(inventory)
          .set({ qtyOnHand: sql`qty_on_hand + ${qty}`, updatedAt: new Date() })
          .where(eq(inventory.id, destInv.id))
      : db.insert(inventory).values({
          id: createId(), warehouseId: toWarehouse,
          productId, variantId: variantId ?? null,
          qtyOnHand: qty, qtyReserved: 0,
        }),

    db.insert(inventoryMovements).values({
      id: createId(), warehouseId: fromWarehouse, productId,
      variantId: variantId ?? null, type: "transfer_out",
      qty, refType: "transfer", refId: transfer.id, createdBy: actorId,
    }),
    db.insert(inventoryMovements).values({
      id: createId(), warehouseId: toWarehouse, productId,
      variantId: variantId ?? null, type: "transfer_in",
      qty, refType: "transfer", refId: transfer.id, createdBy: actorId,
    }),

    db.update(warehouseTransfers)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(warehouseTransfers.id, transfer.id)),
  ]);

  return c.json({ success: true });
});

// ─── PATCH /api/warehouse/transfer/:id/cancel ─────────────────────────────────
// Wajib ada sejak transfer pending mengunci stok: tanpa jalur ini, transfer yang
// batal di dunia nyata akan menahan stoknya selamanya tanpa cara melepas.
warehouseRouter.patch("/transfer/:id/cancel", requireStaff, async (c) => {
  const db       = createD1Client(c.env.DB);
  const transfer = await db.query.warehouseTransfers.findFirst({
    where: eq(warehouseTransfers.id, c.req.param("id")),
  });

  if (!transfer || transfer.status !== "pending") {
    return c.json({ success: false, error: "Transfer tidak ditemukan atau sudah tidak pending" }, 404);
  }

  const { fromWarehouse, productId, variantId, qty } = transfer;
  const actorId = c.get("userId" as any) ?? null;

  // Pelepasan reservasi dan penandaan batal harus menyatu — kalau statusnya
  // gagal tertulis, transfer masih "pending" dan bisa dibatalkan lagi,
  // melepaskan reservasi untuk kedua kalinya.
  await db.batch([
    db.update(inventory)
      .set({ qtyReserved: sql`MAX(0, qty_reserved - ${qty})`, updatedAt: new Date() })
      .where(inventoryRowFilter(fromWarehouse, productId, variantId)),
    db.insert(inventoryMovements).values({
      id: createId(), warehouseId: fromWarehouse, productId,
      variantId: variantId ?? null, type: "release",
      qty, refType: "transfer", refId: transfer.id, createdBy: actorId,
      note: "Transfer dibatalkan",
    }),
    db.update(warehouseTransfers)
      .set({ status: "cancelled" })
      .where(eq(warehouseTransfers.id, transfer.id)),
  ]);

  return c.json({ success: true });
});
