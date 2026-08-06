import type { DbClient } from "@repo/db";
import { inventory, orderItems, inventoryMovements } from "@repo/db/schema";
import { eq, sql } from "drizzle-orm";
import { createId } from "@repo/db";
import { WAREHOUSE_ROUTING } from "@repo/shared";
import type { Env } from "../types/env";

// ─── Stock Lock (Durable Object) ───────────────────────────────────────────────
// Lapisan atomic lock sementara di depan D1 untuk mencegah oversell saat checkout
// concurrent (mis. flash sale). D1 tetap sumber kebenaran persisten untuk stok.
// "__base__" — sentinel yang sama dipakai di catalog.ts untuk stock map produk
// tanpa varian, supaya konvensi "no variant" konsisten di seluruh API.
function stockLockKey(productId: string, variantId: string | undefined, warehouseId: string): string {
  return `${productId}:${variantId ?? "__base__"}:${warehouseId}`;
}

export async function reserveStockLock(
  env: Env,
  warehouseId: string,
  productId: string,
  variantId: string | undefined,
  qty: number,
  maxQty: number,
): Promise<{ success: boolean; reserved: number }> {
  const key  = stockLockKey(productId, variantId, warehouseId);
  const id   = env.STOCK_LOCK_DO.idFromName(key);
  const stub = env.STOCK_LOCK_DO.get(id);

  const res = await stub.fetch("https://stock-lock.internal/reserve", {
    method: "POST",
    body:   JSON.stringify({ key, qty, maxQty, ttlMs: WAREHOUSE_ROUTING.stockReserveTtlMs }),
  });

  return res.json();
}

export async function releaseStockLock(
  env: Env,
  warehouseId: string,
  productId: string,
  variantId: string | undefined,
  qty: number,
): Promise<void> {
  const key  = stockLockKey(productId, variantId, warehouseId);
  const id   = env.STOCK_LOCK_DO.idFromName(key);
  const stub = env.STOCK_LOCK_DO.get(id);

  await stub.fetch("https://stock-lock.internal/release", {
    method: "POST",
    body:   JSON.stringify({ key, qty }),
  });
}

export async function releaseOrderStock(db: DbClient, orderId: string) {
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  for (const item of items) {
    await db.update(inventory)
      .set({
        qtyReserved: sql`MAX(0, qty_reserved - ${item.qty})`,
        updatedAt:   new Date(),
      })
      .where(eq(inventory.warehouseId, item.warehouseId));

    await db.insert(inventoryMovements).values({
      id:          createId(),
      warehouseId: item.warehouseId,
      productId:   item.productId,
      variantId:   item.variantId ?? null,
      type:        "release",
      qty:         item.qty,
      refType:     "order",
      refId:       orderId,
      note:        "Release stok - order dibatalkan",
    });
  }
}

export async function deductOrderStock(db: DbClient, orderId: string) {
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  for (const item of items) {
    // Kurangi available + reserved sekaligus (sudah dipenuhi)
    await db.update(inventory)
      .set({
        qtyAvailable: sql`MAX(0, qty_available - ${item.qty})`,
        qtyReserved:  sql`MAX(0, qty_reserved - ${item.qty})`,
        qtyOnHand:    sql`MAX(0, qty_on_hand - ${item.qty})`,
        updatedAt:    new Date(),
      })
      .where(eq(inventory.warehouseId, item.warehouseId));

    await db.insert(inventoryMovements).values({
      id:          createId(),
      warehouseId: item.warehouseId,
      productId:   item.productId,
      variantId:   item.variantId ?? null,
      type:        "out",
      qty:         item.qty,
      refType:     "order",
      refId:       orderId,
      note:        "Stok keluar - order diproses",
    });
  }
}
