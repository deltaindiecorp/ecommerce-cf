import { describe, it, expect } from "vitest";
import { computeVoucherDiscount, validateVoucher, type Voucher } from "./voucher";

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id:          "voucher-1",
    code:        "HEMAT10",
    type:        "percentage",
    value:       10,
    minPurchase: 0,
    maxDiscount: null,
    usageLimit:  null,
    usageCount:  0,
    isActive:    true,
    startsAt:    null,
    expiresAt:   null,
    createdAt:   null,
    ...overrides,
  };
}

describe("computeVoucherDiscount", () => {
  it("menghitung diskon fixed, dibatasi maksimal subtotal", () => {
    const voucher = makeVoucher({ type: "fixed", value: 20000 });
    expect(computeVoucherDiscount(voucher, 100000)).toBe(20000);
    expect(computeVoucherDiscount(voucher, 10000)).toBe(10000); // tidak boleh melebihi subtotal
  });

  it("menghitung diskon percentage tanpa cap", () => {
    const voucher = makeVoucher({ type: "percentage", value: 10 });
    expect(computeVoucherDiscount(voucher, 100000)).toBe(10000);
  });

  it("menghitung diskon percentage dengan cap maxDiscount", () => {
    const voucher = makeVoucher({ type: "percentage", value: 50, maxDiscount: 20000 });
    expect(computeVoucherDiscount(voucher, 100000)).toBe(20000);
  });

  it("membulatkan ke bawah hasil percentage", () => {
    const voucher = makeVoucher({ type: "percentage", value: 10 });
    expect(computeVoucherDiscount(voucher, 12345)).toBe(1234);
  });
});

describe("validateVoucher", () => {
  it("menolak voucher yang tidak ditemukan", () => {
    const result = validateVoucher(undefined, 50000);
    expect(result.valid).toBe(false);
  });

  it("menolak voucher nonaktif", () => {
    const result = validateVoucher(makeVoucher({ isActive: false }), 50000);
    expect(result.valid).toBe(false);
  });

  it("menolak sebelum startsAt", () => {
    const future = new Date(Date.now() + 86400000);
    const result = validateVoucher(makeVoucher({ startsAt: future }), 50000);
    expect(result.valid).toBe(false);
  });

  it("menolak setelah expiresAt", () => {
    const past = new Date(Date.now() - 86400000);
    const result = validateVoucher(makeVoucher({ expiresAt: past }), 50000);
    expect(result.valid).toBe(false);
  });

  it("menolak saat kuota usageLimit habis", () => {
    const result = validateVoucher(makeVoucher({ usageLimit: 5, usageCount: 5 }), 50000);
    expect(result.valid).toBe(false);
  });

  it("menolak saat subtotal di bawah minPurchase", () => {
    const result = validateVoucher(makeVoucher({ minPurchase: 100000 }), 50000);
    expect(result.valid).toBe(false);
  });

  it("menerima voucher valid dan mengembalikan diskon", () => {
    const result = validateVoucher(makeVoucher({ type: "fixed", value: 15000, minPurchase: 20000 }), 50000);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.discount).toBe(15000);
  });
});
