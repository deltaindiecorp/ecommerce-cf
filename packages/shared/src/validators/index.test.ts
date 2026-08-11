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
  variantUpdateSchema,
  warehouseInputSchema,
  warehouseUpdateSchema,
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

  // Ongkir bukan lagi masukan yang dipercaya. Server menghitungnya sendiri dari
  // kurir + layanan + berat + kota tujuan, jadi apa pun yang dikirim form
  // pembeli harus tidak berpengaruh — termasuk nilai yang jelas-jelas ngawur.
  it.each([0, -1000, 999999999])(
    "mengabaikan shippingCost dari klien (%s) alih-alih memakainya",
    (nilai) => {
      const result = checkoutSchema.safeParse({ ...base, shippingCost: nilai });
      expect(result.success).toBe(true);
      expect(result.success && "shippingCost" in result.data).toBe(false);
    },
  );

  it("mewajibkan kurir dan layanan, karena itu dasar perhitungan ongkir", () => {
    expect(checkoutSchema.safeParse({ ...base, courier: "" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, service: "" }).success).toBe(false);
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

  it("menerima costPrice 0 — modal nol itu sah", () => {
    const result = productInputSchema.safeParse({ ...base, costPrice: 0 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.costPrice).toBe(0);
  });

  it("menolak costPrice negatif", () => {
    expect(productInputSchema.safeParse({ ...base, costPrice: -1 }).success).toBe(false);
  });

  // Form edit mengirim null untuk field yang dikosongkan. Kalau schema menolak
  // null, field nullable tidak akan pernah bisa dibersihkan lewat panel — dan
  // kalau dikirim undefined, drizzle malah melewatinya dan nilai lama bertahan.
  it.each(["costPrice", "comparePrice", "categoryId", "description", "metaTitle", "metaDesc"])(
    "menerima null untuk %s supaya bisa dikosongkan lewat form edit",
    (field) => {
      const result = productUpdateSchema.safeParse({ [field]: null });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data[field as keyof typeof result.data]).toBeNull();
    },
  );

  it("tetap menolak null untuk field wajib", () => {
    expect(productUpdateSchema.safeParse({ name: null }).success).toBe(false);
    expect(productUpdateSchema.safeParse({ price: null }).success).toBe(false);
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
  const base = { name: "Merah / XL", sku: "KP-001-MRH-XL" };

  it("menerima varian valid dengan options", () => {
    const result = variantInputSchema.safeParse({ ...base, options: { warna: "merah", ukuran: "XL" } });
    expect(result.success).toBe(true);
  });

  it("menolak tanpa sku", () => {
    expect(variantInputSchema.safeParse({ name: "Merah / XL" }).success).toBe(false);
  });

  it("menolak name kosong", () => {
    expect(variantInputSchema.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  it("menerima varian minimal — harga/berat boleh ikut produk induk", () => {
    const result = variantInputSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.options).toEqual({});
      expect(result.data.isActive).toBe(true);
    }
  });

  // null di sini berarti "ikut nilai produk induk". Kalau schema menolak null,
  // varian yang sudah punya harga sendiri tidak akan pernah bisa dikembalikan
  // untuk mengikuti produk lewat form edit.
  it.each(["price", "costPrice", "weight", "imageUrl"])(
    "menerima null untuk %s supaya bisa dikembalikan mengikuti produk induk",
    (field) => {
      const result = variantUpdateSchema.safeParse({ [field]: null });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data[field as keyof typeof result.data]).toBeNull();
    },
  );
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


describe("warehouseInputSchema", () => {
  const base = {
    name: "Gudang Jakarta", code: "JKT",
    address: "Jl. Mangga Dua No. 1", city: "Jakarta Pusat", province: "DKI Jakarta",
    postalCode: "10730", rajaongkirCityId: 152,
  };

  it("menerima gudang valid dan memberi default priority 1 + aktif", () => {
    const result = warehouseInputSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe(1);
      expect(result.data.isActive).toBe(true);
    }
  });

  it("menolak kode gudang huruf kecil atau berspasi", () => {
    expect(warehouseInputSchema.safeParse({ ...base, code: "jkt" }).success).toBe(false);
    expect(warehouseInputSchema.safeParse({ ...base, code: "JKT PUSAT" }).success).toBe(false);
  });

  it("menolak kode pos yang bukan 5 angka", () => {
    expect(warehouseInputSchema.safeParse({ ...base, postalCode: "1073" }).success).toBe(false);
  });

  it("menolak rajaongkirCityId kosong atau nol", () => {
    expect(warehouseInputSchema.safeParse({ ...base, rajaongkirCityId: 0 }).success).toBe(false);
  });

  it("menolak priority di bawah 1", () => {
    expect(warehouseInputSchema.safeParse({ ...base, priority: 0 }).success).toBe(false);
  });

  it("warehouseUpdateSchema menerima perubahan sebagian", () => {
    expect(warehouseUpdateSchema.safeParse({ priority: 3 }).success).toBe(true);
    expect(warehouseUpdateSchema.safeParse({ isActive: false }).success).toBe(true);
  });
});
