import { describe, it, expect } from "vitest";
import { createId, generateOrderNo } from "./utils";

describe("createId", () => {
  it("menghasilkan UUID v4 yang valid", () => {
    const id = createId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("menghasilkan id yang berbeda tiap panggilan", () => {
    const ids = new Set(Array.from({ length: 100 }, () => createId()));
    expect(ids.size).toBe(100);
  });
});

describe("generateOrderNo", () => {
  it("mengikuti format INV/YYYYMM/xxxxx", () => {
    const orderNo = generateOrderNo();
    expect(orderNo).toMatch(/^INV\/\d{6}\/\d{5}$/);
  });

  it("menyertakan tahun dan bulan berjalan", () => {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    expect(generateOrderNo()).toContain(`INV/${year}${month}/`);
  });
});
