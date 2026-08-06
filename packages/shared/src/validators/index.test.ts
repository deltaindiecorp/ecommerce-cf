import { describe, it, expect } from "vitest";
import {
  shippingAddressSchema,
  checkoutSchema,
  addToCartSchema,
  paginationSchema,
  productInputSchema,
  productUpdateSchema,
  categoryInputSchema,
  variantInputSchema,
  inventoryAdjustSchema,
  voucherInputSchema,
} from "./index";

describe("shippingAddressSchema", () => {
  const valid = {
    name: "Budi",
    phone: "081234567890",
    address: "Jl. Merdeka No. 1",
    district: "Menteng",
    city: "Jakarta Pusat",
    province: "DKI Jakarta",
    postalCode: "10310",
    rajaongkirCityId: 152,
  };

  it("menerima alamat valid", () => {
    expect(shippingAddressSchema.safeParse(valid).success).toBe(true);
  });

  it("menolak no HP tanpa awalan 08/62/+62", () => {
    const result = shippingAddressSchema.safeParse({ ...valid, phone: "1234567890" });
    expect(result.success).toBe(false);
  });

  it("menolak kode pos bukan 5 digit", () => {
    const result = shippingAddressSchema.safeParse({ ...valid, postalCode: "123" });
    expect(result.success).toBe(false);
  });

  it("menolak rajaongkirCityId negatif", () => {
    const result = shippingAddressSchema.safeParse({ ...valid, rajaongkirCityId: -1 });
    expect(result.success).toBe(false);
  });
});

describe("checkoutSchema", () => {
  const base = {
    shippingAddress: {
      name: "Budi", phone: "081234567890", address: "Jl. Merdeka No. 1",
      district: "Menteng", city: "Jakarta Pusat", province: "DKI Jakarta",
      postalCode: "10310", rajaongkirCityId: 152,
    },
    courier: "jne",
    service: "REG",
    shippingCost: 15000,
    paymentMethod: "midtrans" as const,
  };

  it("valid tanpa data guest (user login)", () => {
    expect(checkoutSchema.safeParse(base).success).toBe(true);
  });

  it("valid dengan data guest lengkap", () => {
    const result = checkoutSchema.safeParse({
      ...base,
      guestName: "Budi", guestEmail: "budi@example.com", guestPhone: "081234567890",
    });
    expect(result.success).toBe(true);
  });

  it("menolak paymentMethod yang tidak dikenal", () => {
    const result = checkoutSchema.safeParse({ ...base, paymentMethod: "bitcoin" });
    expect(result.success).toBe(false);
  });

  it("menolak shippingCost negatif", () => {
    const result = checkoutSchema.safeParse({ ...base, shippingCost: -1000 });
    expect(result.success).toBe(false);
  });
});

describe("addToCartSchema", () => {
  it("menerima productId UUID dengan qty valid", () => {
    const result = addToCartSchema.safeParse({
      productId: "123e4567-e89b-12d3-a456-426614174000",
      qty: 2,
    });
    expect(result.success).toBe(true);
  });

  it("menolak qty 0", () => {
    const result = addToCartSchema.safeParse({
      productId: "123e4567-e89b-12d3-a456-426614174000",
      qty: 0,
    });
    expect(result.success).toBe(false);
  });

  it("menolak qty di atas 100", () => {
    const result = addToCartSchema.safeParse({
      productId: "123e4567-e89b-12d3-a456-426614174000",
      qty: 101,
    });
    expect(result.success).toBe(false);
  });

  it("menolak productId yang bukan UUID", () => {
    const result = addToCartSchema.safeParse({ productId: "not-a-uuid", qty: 1 });
    expect(result.success).toBe(false);
  });
});

describe("paginationSchema", () => {
  it("memberi default page=1 limit=20 saat kosong", () => {
    const result = paginationSchema.parse({});
    expect(result).toEqual({ page: 1, limit: 20 });
  });

  it("meng-coerce string query params jadi number", () => {
    const result = paginationSchema.parse({ page: "3", limit: "50" });
    expect(result).toEqual({ page: 3, limit: 50 });
  });

  it("menolak limit di atas 100", () => {
    expect(() => paginationSchema.parse({ limit: "101" })).toThrow();
  });
});

describe("productInputSchema", () => {
  const base = { name: "Kaos Polos", slug: "kaos-polos", sku: "KP-001", price: 50000 };

  it("menerima produk minimal valid", () => {
    expect(productInputSchema.safeParse(base).success).toBe(true);
  });

  it("menolak slug berhuruf besar / spasi", () => {
    expect(productInputSchema.safeParse({ ...base, slug: "Kaos Polos" }).success).toBe(false);
  });

  it("menolak price negatif", () => {
    expect(productInputSchema.safeParse({ ...base, price: -1000 }).success).toBe(false);
  });

  it("default status draft dan isFeatured false", () => {
    const result = productInputSchema.parse(base);
    expect(result.status).toBe("draft");
    expect(result.isFeatured).toBe(false);
  });

  it("productUpdateSchema (partial) menerima objek kosong", () => {
    expect(productUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describe("categoryInputSchema", () => {
  it("menerima kategori valid", () => {
    const result = categoryInputSchema.safeParse({ name: "Elektronik", slug: "elektronik" });
    expect(result.success).toBe(true);
  });

  it("menolak slug kosong", () => {
    expect(categoryInputSchema.safeParse({ name: "Elektronik", slug: "" }).success).toBe(false);
  });
});

describe("variantInputSchema", () => {
  it("menerima varian valid dengan options", () => {
    const result = variantInputSchema.safeParse({ name: "Merah / XL", sku: "KP-001-RED-XL", options: { warna: "merah", ukuran: "XL" } });
    expect(result.success).toBe(true);
  });

  it("menolak tanpa sku", () => {
    expect(variantInputSchema.safeParse({ name: "Merah / XL" }).success).toBe(false);
  });
});

describe("inventoryAdjustSchema", () => {
  it("menerima qty positif (stok masuk)", () => {
    const result = inventoryAdjustSchema.safeParse({ productId: "123e4567-e89b-12d3-a456-426614174000", qty: 10 });
    expect(result.success).toBe(true);
  });

  it("menerima qty negatif (koreksi turun)", () => {
    const result = inventoryAdjustSchema.safeParse({ productId: "123e4567-e89b-12d3-a456-426614174000", qty: -5 });
    expect(result.success).toBe(true);
  });

  it("menolak qty 0", () => {
    const result = inventoryAdjustSchema.safeParse({ productId: "123e4567-e89b-12d3-a456-426614174000", qty: 0 });
    expect(result.success).toBe(false);
  });
});

describe("voucherInputSchema", () => {
  const base = { code: "HEMAT10", type: "percentage" as const, value: 10 };

  it("menerima voucher percentage minimal valid", () => {
    expect(voucherInputSchema.safeParse(base).success).toBe(true);
  });

  it("menolak value 0 atau negatif", () => {
    expect(voucherInputSchema.safeParse({ ...base, value: 0 }).success).toBe(false);
  });

  it("menolak kode dengan karakter tidak diizinkan", () => {
    expect(voucherInputSchema.safeParse({ ...base, code: "HEMAT 10%" }).success).toBe(false);
  });

  it("default minPurchase 0 dan isActive true", () => {
    const result = voucherInputSchema.parse(base);
    expect(result.minPurchase).toBe(0);
    expect(result.isActive).toBe(true);
  });
});
