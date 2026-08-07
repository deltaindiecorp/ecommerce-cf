import type { DbClient } from "@repo/db";
import { inventory, orderItems, inventoryMovements } from "@repo/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
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

// ─── Identitas baris inventory ────────────────────────────────────────────────
// Satu baris inventory diidentifikasi oleh (gudang, produk, varian) — BUKAN
// gudang saja. Filter ini dipakai bersama oleh reserve (checkout), release, dan
// deduct supaya ketiganya selalu menyasar baris yang sama persis; kalau salah
// satu filternya beda, stok bisa dipotong dari produk yang tidak ada
// hubungannya dengan order tersebut.
export function inventoryRowFilter(
  warehouseId: string,
  productId: string,
  variantId?: string | null,
) {
  return and(
    eq(inventory.warehouseId, warehouseId),
    eq(inventory.productId, productId),
    variantId ? eq(inventory.variantId, variantId) : isNull(inventory.variantId),
  );
}

// Kunci per-item untuk cek idempotensi. Sentinel "__base__" sama dengan yang
// dipakai stockLockKey supaya konvensi "tanpa varian" konsisten.
function itemKey(productId: string, variantId?: string | null): string {
  return `${productId}:${variantId ?? "__base__"}`;
}

// Item mana dari order ini yang sudah pernah diproses untuk `type` tertentu.
// Dicek per item (bukan per order) supaya kalau proses mati di tengah loop,
// pemanggilan ulang tetap menyelesaikan sisa item tanpa mengulang yang sudah
// terlanjur diterapkan.
async function appliedItemKeys(
  db: DbClient,
  orderId: string,
  type: "out" | "release",
): Promise<Set<string>> {
  const rows = await db
    .select({
      productId: inventoryMovements.productId,
      variantId: inventoryMovements.variantId,
    })
    .from(inventoryMovements)
    .where(and(
      eq(inventoryMovements.refType, "order"),
      eq(inventoryMovements.refId, orderId),
      eq(inventoryMovements.type, type),
    ));

  return new Set(rows.map(r => itemKey(r.productId, r.variantId)));
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

// Melepas reservasi (qty_reserved) — kebalikan dari reserve saat checkout.
// Dipanggil saat order batal / refund sebelum dikirim / pembayaran kedaluwarsa.
// Tidak menyentuh qty_on_hand karena barangnya memang belum pernah keluar rak.
export async function releaseOrderStock(db: DbClient, orderId: string) {
  const items   = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const applied = await appliedItemKeys(db, orderId, "release");

  for (const item of items) {
    if (applied.has(itemKey(item.productId, item.variantId))) continue;

    await db.update(inventory)
      .set({
        qtyReserved: sql`MAX(0, qty_reserved - ${item.qty})`,
        updatedAt:   new Date(),
      })
      .where(inventoryRowFilter(item.warehouseId, item.productId, item.variantId));

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

// Mengubah reservasi jadi pengurangan stok riil — barang benar-benar keluar
// gudang. Dipanggil saat order masuk salah satu FULFILLED_STATUSES (shipped/
// delivered/completed), dari mana pun transisi itu datang: PATCH status admin,
// input resi, atau resi-poller yang menyetel "delivered" otomatis.
//
// Idempoten per item, jadi aman kalau admin bolak-balik mengubah status atau
// dua jalur menyetel status terpenuhi hampir bersamaan. Ini penting karena
// belum ada state machine yang menjaga urutan transisi order.
export async function deductOrderStock(db: DbClient, orderId: string) {
  const items   = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const applied = await appliedItemKeys(db, orderId, "out");

  for (const item of items) {
    if (applied.has(itemKey(item.productId, item.variantId))) continue;

    // Kurangi available + reserved sekaligus (sudah dipenuhi)
    await db.update(inventory)
      .set({
        qtyAvailable: sql`MAX(0, qty_available - ${item.qty})`,
        qtyReserved:  sql`MAX(0, qty_reserved - ${item.qty})`,
        qtyOnHand:    sql`MAX(0, qty_on_hand - ${item.qty})`,
        updatedAt:    new Date(),
      })
      .where(inventoryRowFilter(item.warehouseId, item.productId, item.variantId));

    await db.insert(inventoryMovements).values({
      id:          createId(),
      warehouseId: item.warehouseId,
      productId:   item.productId,
      variantId:   item.variantId ?? null,
      type:        "out",
      qty:         item.qty,
      refType:     "order",
      refId:       orderId,
      note:        "Stok keluar - order dikirim",
    });
  }
}
