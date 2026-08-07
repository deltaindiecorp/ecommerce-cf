import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { getTableColumns } from "drizzle-orm";
import { orderItems } from "@repo/db/schema";
import type { DbClient } from "@repo/db";

import { deductOrderStock, releaseOrderStock } from "./inventory";

// ─── Harness ──────────────────────────────────────────────────────────────────
// Pakai driver sqlite-proxy supaya assertion menyasar SQL yang benar-benar
// dihasilkan drizzle. Kalau filter WHERE-nya salah lagi (mis. cuma warehouse_id),
// test ini gagal — bukan sekadar memverifikasi mock yang ikut ditulis salah.

type Recorded = { sql: string; params: unknown[]; method: string };

type FakeItem = {
  warehouseId: string;
  productId:   string;
  variantId:   string | null;
  qty:         number;
};

function positionalRow(obj: Record<string, unknown>): unknown[] {
  return Object.keys(getTableColumns(orderItems)).map(col => obj[col] ?? null);
}

function makeDb(opts: {
  items:    FakeItem[];
  applied?: Array<{ productId: string; variantId: string | null }>;
}) {
  const calls: Recorded[] = [];

  const db = drizzle(async (sql, params, method) => {
    calls.push({ sql, params, method });

    if (sql.includes("order_items")) {
      return { rows: opts.items.map(i => positionalRow(i as unknown as Record<string, unknown>)) };
    }
    if (sql.includes("inventory_movements") && method !== "run") {
      return { rows: (opts.applied ?? []).map(m => [m.productId, m.variantId]) };
    }
    return { rows: [] };
  });

  const inventoryUpdates = () =>
    calls.filter(c => c.sql.includes('update "inventory"') && !c.sql.includes("inventory_movements"));

  return { db: db as unknown as DbClient, calls, inventoryUpdates };
}

const ITEM_A: FakeItem = { warehouseId: "wh-jkt", productId: "prod-a", variantId: null,        qty: 2 };
const ITEM_B: FakeItem = { warehouseId: "wh-jkt", productId: "prod-b", variantId: "var-merah", qty: 5 };

// ─── deductOrderStock ─────────────────────────────────────────────────────────
describe("deductOrderStock", () => {
  it("memfilter baris inventory per produk, bukan seluruh gudang", async () => {
    const { db, inventoryUpdates } = makeDb({ items: [ITEM_A] });
    await deductOrderStock(db, "order-1");

    const updates = inventoryUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("product_id");
    expect(updates[0].params).toContain("prod-a");
    expect(updates[0].params).toContain("wh-jkt");
  });

  it("menyertakan variant_id saat item punya varian", async () => {
    const { db, inventoryUpdates } = makeDb({ items: [ITEM_B] });
    await deductOrderStock(db, "order-1");

    const [update] = inventoryUpdates();
    expect(update.sql).toContain("variant_id");
    expect(update.params).toContain("var-merah");
  });

  it("memakai IS NULL untuk item tanpa varian, bukan mencocokkan semua varian", async () => {
    const { db, inventoryUpdates } = makeDb({ items: [ITEM_A] });
    await deductOrderStock(db, "order-1");

    expect(inventoryUpdates()[0].sql.toLowerCase()).toContain("variant_id\" is null");
  });

  it("memotong qty_on_hand, qty_available, dan qty_reserved sekaligus", async () => {
    const { db, inventoryUpdates } = makeDb({ items: [ITEM_A] });
    await deductOrderStock(db, "order-1");

    const sql = inventoryUpdates()[0].sql;
    expect(sql).toContain("qty_on_hand");
    expect(sql).toContain("qty_available");
    expect(sql).toContain("qty_reserved");
  });

  it("melewati item yang stoknya sudah pernah dipotong (idempoten)", async () => {
    const { db, inventoryUpdates } = makeDb({
      items:   [ITEM_A],
      applied: [{ productId: "prod-a", variantId: null }],
    });
    await deductOrderStock(db, "order-1");

    expect(inventoryUpdates()).toHaveLength(0);
  });

  it("tetap memproses item lain yang belum dipotong saat sebagian sudah", async () => {
    const { db, inventoryUpdates } = makeDb({
      items:   [ITEM_A, ITEM_B],
      applied: [{ productId: "prod-a", variantId: null }],
    });
    await deductOrderStock(db, "order-1");

    const updates = inventoryUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].params).toContain("prod-b");
  });

  it("membedakan varian dari produk yang sama saat cek idempotensi", async () => {
    const itemVarBiru: FakeItem = { ...ITEM_B, variantId: "var-biru" };
    const { db, inventoryUpdates } = makeDb({
      items:   [ITEM_B, itemVarBiru],
      applied: [{ productId: "prod-b", variantId: "var-merah" }],
    });
    await deductOrderStock(db, "order-1");

    const updates = inventoryUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].params).toContain("var-biru");
  });
});

// ─── releaseOrderStock ────────────────────────────────────────────────────────
describe("releaseOrderStock", () => {
  it("memfilter baris inventory per produk, bukan seluruh gudang", async () => {
    const { db, inventoryUpdates } = makeDb({ items: [ITEM_A] });
    await releaseOrderStock(db, "order-1");

    const updates = inventoryUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("product_id");
    expect(updates[0].params).toContain("prod-a");
  });

  it("hanya melepas qty_reserved, tidak menyentuh stok fisik", async () => {
    const { db, inventoryUpdates } = makeDb({ items: [ITEM_A] });
    await releaseOrderStock(db, "order-1");

    const sql = inventoryUpdates()[0].sql;
    expect(sql).toContain("qty_reserved");
    expect(sql).not.toContain("qty_on_hand");
    expect(sql).not.toContain("qty_available");
  });

  it("melewati item yang reservasinya sudah pernah dilepas (idempoten)", async () => {
    const { db, inventoryUpdates } = makeDb({
      items:   [ITEM_A],
      applied: [{ productId: "prod-a", variantId: null }],
    });
    await releaseOrderStock(db, "order-1");

    expect(inventoryUpdates()).toHaveLength(0);
  });
});
