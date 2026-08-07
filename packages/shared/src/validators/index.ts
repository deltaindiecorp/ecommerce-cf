import { z } from "zod";

export const shippingAddressSchema = z.object({
  name:              z.string().min(2),
  phone:             z.string().regex(/^(\+62|62|0)[0-9]{8,12}$/, "Format no HP tidak valid"),
  address:           z.string().min(5),
  district:          z.string().min(2),
  city:              z.string().min(2),
  province:          z.string().min(2),
  postalCode:        z.string().regex(/^\d{5}$/, "Kode pos harus 5 angka"),
  rajaongkirCityId:  z.number().int().positive(),
});

export const guestInfoSchema = z.object({
  guestName:  z.string().min(2),
  guestEmail: z.string().email("Format email tidak valid"),
  guestPhone: z.string().regex(/^(\+62|62|0)[0-9]{8,12}$/, "Format no HP tidak valid"),
});

export const checkoutSchema = z.object({
  ...guestInfoSchema.shape,
  shippingAddress: shippingAddressSchema,
  courier:        z.string(),
  service:        z.string(),
  shippingCost:   z.number().int().min(0),
  paymentMethod:  z.enum(["midtrans", "xendit", "cod"]),
  voucherCode:    z.string().optional(),
  note:           z.string().max(500).optional(),
}).partial({ guestName: true, guestEmail: true, guestPhone: true });

export const addToCartSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  qty:       z.number().int().min(1).max(100),
});

export const paginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Admin: Product / Category / Variant ──────────────────────────────────────
const slugSchema = z.string().min(2).regex(/^[a-z0-9-]+$/, "Slug hanya boleh huruf kecil, angka, dan strip");

// Kolom nullable di DB dibuat .nullable() juga di schema — bukan cuma .optional().
// Bedanya penting saat update: `undefined` dilewati drizzle (nilai lama bertahan),
// sedangkan `null` benar-benar menulis NULL. Tanpa ini, form edit tidak akan bisa
// mengosongkan harga modal, harga coret, atau kategori.
export const productInputSchema = z.object({
  categoryId:   z.string().uuid().nullable().optional(),
  name:         z.string().min(2),
  slug:         slugSchema,
  sku:          z.string().min(1),
  description:  z.string().nullable().optional(),
  price:        z.number().int().positive(),
  comparePrice: z.number().int().positive().nullable().optional(),
  // min(0) bukan positive(): modal 0 sah (barang sampel/hadiah), sementara
  // tidak diisi sama sekali tetap dibedakan sebagai NULL.
  costPrice:    z.number().int().min(0).nullable().optional(),
  weight:       z.number().int().min(0).default(0),
  width:        z.number().int().min(0).optional(),
  height:       z.number().int().min(0).optional(),
  length:       z.number().int().min(0).optional(),
  images:       z.array(z.string()).default([]),
  tags:         z.array(z.string()).default([]),
  status:       z.enum(["active", "draft", "archived"]).default("draft"),
  isFeatured:   z.boolean().default(false),
  metaTitle:    z.string().nullable().optional(),
  metaDesc:     z.string().nullable().optional(),
});
export const productUpdateSchema = productInputSchema.partial();

export const categoryInputSchema = z.object({
  parentId:  z.string().uuid().optional(),
  name:      z.string().min(2),
  slug:      slugSchema,
  imageUrl:  z.string().optional(),
  sortOrder: z.number().int().default(0),
  isActive:  z.boolean().default(true),
});
export const categoryUpdateSchema = categoryInputSchema.partial();

// Sama seperti productInputSchema: kolom nullable di DB dibuat .nullable() juga
// supaya form edit bisa mengosongkannya (undefined dilewati drizzle, null ditulis).
export const variantInputSchema = z.object({
  name:      z.string().min(1),
  sku:       z.string().min(1),
  price:     z.number().int().positive().nullable().optional(), // null = ikut harga produk
  costPrice: z.number().int().min(0).nullable().optional(),
  weight:    z.number().int().min(0).nullable().optional(),     // null = ikut berat produk
  options:   z.record(z.string()).default({}),
  imageUrl:  z.string().nullable().optional(),
  isActive:  z.boolean().default(true),
});
export const variantUpdateSchema = variantInputSchema.partial();

// ─── Admin: Gudang ────────────────────────────────────────────────────────────
// `priority` menentukan urutan gudang saat routing checkout (1 = paling
// diutamakan), `isActive` menentukan gudang boleh dipakai memenuhi order atau
// tidak — keduanya dibaca langsung oleh POST /api/checkout.
export const warehouseInputSchema = z.object({
  name:             z.string().min(2),
  code:             z.string().min(2).max(10).regex(/^[A-Z0-9-]+$/, "Kode gudang huruf besar, angka, dan strip saja"),
  address:          z.string().min(5),
  city:             z.string().min(2),
  province:         z.string().min(2),
  postalCode:       z.string().regex(/^\d{5}$/, "Kode pos harus 5 angka"),
  rajaongkirCityId: z.number().int().positive(),
  phone:            z.string().nullable().optional(),
  picName:          z.string().nullable().optional(),
  isActive:         z.boolean().default(true),
  priority:         z.number().int().min(1).default(1),
});
export const warehouseUpdateSchema = warehouseInputSchema.partial();

// ─── Admin: Inventory Adjustment ───────────────────────────────────────────────
export const inventoryAdjustSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  qty:       z.number().int().refine(v => v !== 0, "qty tidak boleh 0"), // + stok masuk, - koreksi turun
  note:      z.string().max(200).optional(),
});

// ─── Admin: Voucher ─────────────────────────────────────────────────────────────
export const voucherInputSchema = z.object({
  code:        z.string().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/, "Kode hanya boleh huruf, angka, _, -"),
  type:        z.enum(["percentage", "fixed"]),
  value:       z.number().int().positive(),
  minPurchase: z.number().int().min(0).default(0),
  maxDiscount: z.number().int().positive().optional(),
  usageLimit:  z.number().int().positive().optional(),
  isActive:    z.boolean().default(true),
  startsAt:    z.string().datetime().optional(),
  expiresAt:   z.string().datetime().optional(),
});
export const voucherUpdateSchema = voucherInputSchema.partial();
