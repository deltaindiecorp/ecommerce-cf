import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { products, productVariants } from "@repo/db/schema";

import {
  catalogRouter,
  PUBLIC_PRODUCT_COLUMNS,
  PUBLIC_VARIANT_COLUMNS,
  INTERNAL_PRODUCT_COLUMNS,
  INTERNAL_VARIANT_COLUMNS,
  publicProductSelect,
} from "./catalog";

// D1 tiruan yang merekam setiap SQL yang dieksekusi handler. Dipakai untuk
// membuktikan query yang benar-benar jalan tidak menyentuh kolom internal —
// bukan cuma konstanta proyeksinya yang benar.
function makeRecordingEnv() {
  const executed: string[] = [];

  const makeStmt = (sql: string) => {
    const stmt: Record<string, unknown> = {
      bind:  () => stmt,
      all:   async () => ({ results: [], success: true, meta: {} }),
      run:   async () => ({ results: [], success: true, meta: {} }),
      raw:   async () => [],
      first: async () => null,
    };
    return stmt;
  };

  const env = {
    DB: {
      prepare: (sql: string) => { executed.push(sql); return makeStmt(sql); },
      batch:   async (stmts: unknown[]) => stmts.map(() => ({ results: [], success: true, meta: {} })),
    },
    CACHE_KV: {
      get: async () => null,
      put: async () => undefined,
    },
  };

  return { env, executed };
}

// Endpoint katalog dikonsumsi storefront publik dan hasilnya ikut di-cache ke
// KV. Kebocoran kolom internal di sini tidak akan terlihat dari UI admin mana
// pun — makanya dikunci test, bukan sekadar code review.

describe("proyeksi kolom katalog publik", () => {
  it("tidak membocorkan harga modal produk", () => {
    expect(PUBLIC_PRODUCT_COLUMNS).not.toHaveProperty("costPrice");
    expect(publicProductSelect).not.toHaveProperty("costPrice");
  });

  it("tidak membocorkan harga modal varian", () => {
    expect(PUBLIC_VARIANT_COLUMNS).not.toHaveProperty("costPrice");
  });

  it("mengklasifikasikan semua kolom products sebagai publik atau internal", () => {
    const schemaColumns = Object.keys(getTableColumns(products)).sort();
    const classified    = [
      ...Object.keys(PUBLIC_PRODUCT_COLUMNS),
      ...INTERNAL_PRODUCT_COLUMNS,
    ].sort();

    // Kalau gagal: ada kolom baru di schema yang belum diputuskan boleh publik
    // atau tidak. Tambahkan ke PUBLIC_PRODUCT_COLUMNS atau INTERNAL_PRODUCT_COLUMNS.
    expect(classified).toEqual(schemaColumns);
  });

  it("mengklasifikasikan semua kolom product_variants sebagai publik atau internal", () => {
    const schemaColumns = Object.keys(getTableColumns(productVariants)).sort();
    const classified    = [
      ...Object.keys(PUBLIC_VARIANT_COLUMNS),
      ...INTERNAL_VARIANT_COLUMNS,
    ].sort();

    expect(classified).toEqual(schemaColumns);
  });

  it("GET /products tidak pernah meng-query cost_price", async () => {
    const { env, executed } = makeRecordingEnv();
    const res = await catalogRouter.request("/products", {}, env);

    expect(res.status).toBe(200);
    expect(executed.length).toBeGreaterThan(0);
    expect(executed.some(sql => sql.includes("cost_price"))).toBe(false);
  });

  it("GET /products/:slug tidak pernah meng-query cost_price", async () => {
    const { env, executed } = makeRecordingEnv();
    await catalogRouter.request("/products/kaos-polos", {}, env);

    expect(executed.length).toBeGreaterThan(0);
    expect(executed.some(sql => sql.includes("cost_price"))).toBe(false);
  });

  it("publicProductSelect konsisten dengan PUBLIC_PRODUCT_COLUMNS", () => {
    // Dua bentuk proyeksi untuk dua gaya query drizzle (select vs findFirst).
    // Kalau isinya berbeda, satu endpoint bisa bocor sementara yang lain aman.
    expect(Object.keys(publicProductSelect).sort())
      .toEqual(Object.keys(PUBLIC_PRODUCT_COLUMNS).sort());
  });
});
