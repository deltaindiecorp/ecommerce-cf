import { Hono } from "hono";
import type { Env } from "../types/env";
import { requireAdmin } from "../middleware/auth";
import { createD1Client } from "@repo/db";
import { warehouses, inventory, warehouseTransfers, inventoryMovements } from "@repo/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { createId } from "@repo/db";
import { inventoryAdjustSchema } from "@repo/shared";

export const warehouseRouter = new Hono<{ Bindings: Env }>();

// ─── GET /api/warehouse ───────────────────────────────────────────────────────
warehouseRouter.get("/", requireAdmin, async (c) => {
  const db   = createD1Client(c.env.DB);
  const rows = await db.select().from(warehouses).orderBy(warehouses.priority);
  return c.json({ success: true, data: rows });
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

  const existing = await db.query.inventory.findFirst({
    where: and(
      eq(inventory.warehouseId, warehouseId),
      eq(inventory.productId, productId),
      ...(variantId ? [eq(inventory.variantId, variantId)] : [])
    ),
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

// ─── POST /api/warehouse/transfer ────────────────────────────────────────────
warehouseRouter.post("/transfer", requireAdmin, async (c) => {
  const { fromWarehouse, toWarehouse, productId, variantId, qty, note } =
    await c.req.json<{
      fromWarehouse: string; toWarehouse: string;
      productId: string; variantId?: string;
      qty: number; note?: string;
    }>();

  const db = createD1Client(c.env.DB);

  // Cek stok source warehouse
  const srcInv = await db.query.inventory.findFirst({
    where: and(
      eq(inventory.warehouseId, fromWarehouse),
      eq(inventory.productId, productId),
    ),
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

  // Kurangi stok source
  await db.update(inventory)
    .set({ qtyAvailable: sql`qty_available - ${transfer.qty}`, updatedAt: new Date() })
    .where(and(
      eq(inventory.warehouseId, transfer.fromWarehouse),
      eq(inventory.productId, transfer.productId),
    ));

  // Tambah stok destination (upsert)
  const destInv = await db.query.inventory.findFirst({
    where: and(
      eq(inventory.warehouseId, transfer.toWarehouse),
      eq(inventory.productId, transfer.productId),
    ),
  });

  if (destInv) {
    await db.update(inventory)
      .set({ qtyAvailable: destInv.qtyAvailable + transfer.qty, updatedAt: new Date() })
      .where(eq(inventory.id, destInv.id));
  } else {
    await db.insert(inventory).values({
      id: createId(), warehouseId: transfer.toWarehouse,
      productId: transfer.productId, variantId: transfer.variantId,
      qtyAvailable: transfer.qty, qtyReserved: 0, qtyOnHand: transfer.qty,
    });
  }

  // Log movements
  for (const [type, warehouseId] of [
    ["transfer_out", transfer.fromWarehouse],
    ["transfer_in",  transfer.toWarehouse],
  ] as const) {
    await db.insert(inventoryMovements).values({
      id: createId(), warehouseId, productId: transfer.productId,
      variantId: transfer.variantId, type,
      qty: transfer.qty, refType: "transfer", refId: transfer.id,
    });
  }

  await db.update(warehouseTransfers)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(warehouseTransfers.id, transfer.id));

  return c.json({ success: true });
});
