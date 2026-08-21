import { describe, it, expect } from "vitest";

import { warehouseRouter } from "./warehouse";
import { signJwt } from "../middleware/auth";
import { makeRecordingD1 } from "../test-utils/fake-d1";

const JWT_SECRET = "rahasia-uji-yang-cukup-panjang-untuk-hmac";

const WH_A = "11111111-1111-4111-8111-111111111111";
const WH_B = "22222222-2222-4222-8222-222222222222";
const PROD = "33333333-3333-4333-8333-333333333333";
const VAR  = "44444444-4444-4444-8444-444444444444";

async function adminHeaders() {
  const token = await signJwt({ sub: "admin-1", role: "admin" }, JWT_SECRET);
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function postTransfer(body: unknown, rows?: (sql: string, m: string) => unknown[]) {
  const d1  = makeRecordingD1({ JWT_SECRET }, rows);
  const res = await warehouseRouter.request(
    "/transfer",
    { method: "POST", headers: await adminHeaders(), body: JSON.stringify(body) },
    d1.env,
  );
  return { res, d1 };
}

const VALID = { fromWarehouse: WH_A, toWarehouse: WH_B, productId: PROD, qty: 5 };

describe("POST /api/warehouse/transfer — validasi", () => {
  it("menolak gudang asal dan tujuan yang sama", async () => {
    const { res } = await postTransfer({ ...VALID, toWarehouse: WH_A });
    expect(res.status).toBe(400);
  });

  it("menolak qty nol atau negatif", async () => {
    expect((await postTransfer({ ...VALID, qty: 0 })).res.status).toBe(400);
    expect((await postTransfer({ ...VALID, qty: -3 })).res.status).toBe(400);
  });

  it("menolak id yang bukan UUID", async () => {
    const { res } = await postTransfer({ ...VALID, productId: "bukan-uuid" });
    expect(res.status).toBe(400);
  });

  it("tidak menyentuh DB sama sekali saat validasi gagal", async () => {
    const { d1 } = await postTransfer({ ...VALID, qty: -1 });
    expect(d1.executed).toHaveLength(0);
  });
});

describe("POST /api/warehouse/transfer — reservasi stok", () => {
  // Gudang ada, tapi inventory-nya kosong → stok tidak cukup, tidak ada reservasi.
  it("menolak saat stok tidak mencukupi dan tidak mereservasi apa pun", async () => {
    const { res, d1 } = await postTransfer(VALID, (sql) =>
      sql.includes("warehouses") ? [{ id: WH_A }] : [],
    );

    expect(res.status).toBe(400);
    expect(d1.allSql()).not.toContain("qty_reserved +");
  });
});

describe("filter baris inventory pada transfer", () => {
  // Regresi: versi lama memfilter hanya (warehouse_id, product_id), sehingga
  // transfer satu varian mengubah stok SEMUA varian produk tersebut.
  it("menyertakan variant_id saat mencari stok gudang asal", async () => {
    const { d1 } = await postTransfer(
      { ...VALID, variantId: VAR },
      (sql) => (sql.includes("warehouses") ? [{ id: WH_A }] : []),
    );

    const inventorySql = d1.executed
      .filter(e => e.sql.includes("inventory") && !e.sql.includes("inventory_movements"))
      .map(e => e.sql)
      .join("\n");

    expect(inventorySql).toContain("variant_id");
    expect(inventorySql).toContain("product_id");
  });

  it("memakai IS NULL untuk produk tanpa varian", async () => {
    const { d1 } = await postTransfer(VALID, (sql) =>
      sql.includes("warehouses") ? [{ id: WH_A }] : [],
    );

    const inventorySql = d1.executed
      .filter(e => e.sql.includes("inventory") && !e.sql.includes("inventory_movements"))
      .map(e => e.sql)
      .join("\n")
      .toLowerCase();

    expect(inventorySql).toContain('variant_id" is null');
  });
});

describe("otorisasi", () => {
  it("menolak transfer tanpa token", async () => {
    const d1  = makeRecordingD1({ JWT_SECRET });
    const res = await warehouseRouter.request(
      "/transfer",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(VALID) },
      d1.env,
    );

    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(d1.executed).toHaveLength(0);
  });
});
