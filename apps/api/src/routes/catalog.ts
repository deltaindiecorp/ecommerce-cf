import { Hono } from "hono";
import type { Env } from "../types/env";
import { createD1Client, createId } from "@repo/db";
import { products, categories, inventory, productVariants } from "@repo/db/schema";
import { eq, like, and, sql } from "drizzle-orm";
import {
  KV_KEYS, KV_TTL, paginationSchema,
  productInputSchema, productUpdateSchema,
  categoryInputSchema, categoryUpdateSchema,
  variantInputSchema, variantUpdateSchema,
} from "@repo/shared";
import { requireAdmin, requireStaff } from "../middleware/auth";
import { logAdminAction } from "../services/audit";

export const catalogRouter = new Hono<{ Bindings: Env }>();

// ─── Proyeksi kolom publik ────────────────────────────────────────────────────
// Endpoint katalog dikonsumsi storefront dan hasilnya ikut di-cache ke KV, jadi
// kolomnya HARUS disebut eksplisit — bukan `select()` polos. `costPrice` adalah
// data bisnis internal; kalau ikut terkirim, margin tiap produk bisa di-scrape
// siapa pun. Kolom baru yang sensitif cukup tidak didaftarkan di sini.
// Kolom yang TIDAK boleh keluar ke publik. Daftar ini diuji di catalog.test.ts:
// begitu ada kolom baru di schema yang tidak masuk daftar publik maupun daftar
// ini, test gagal — jadi penambah kolom dipaksa memilih secara sadar.
export const INTERNAL_PRODUCT_COLUMNS = ["costPrice"] as const;
export const INTERNAL_VARIANT_COLUMNS = ["costPrice"] as const;

export const PUBLIC_PRODUCT_COLUMNS = {
  id: true, categoryId: true, name: true, slug: true, sku: true,
  description: true, price: true, comparePrice: true,
  weight: true, width: true, height: true, length: true,
  images: true, tags: true, status: true, isFeatured: true,
  trackInventory: true,
  metaTitle: true, metaDesc: true, createdAt: true, updatedAt: true,
} as const;

export const PUBLIC_VARIANT_COLUMNS = {
  id: true, productId: true, name: true, sku: true,
  price: true, weight: true, options: true, imageUrl: true,
  isActive: true, createdAt: true,
} as const;

export const publicProductSelect = {
  id:           products.id,
  categoryId:   products.categoryId,
  name:         products.name,
  slug:         products.slug,
  sku:          products.sku,
  description:  products.description,
  price:        products.price,
  comparePrice: products.comparePrice,
  weight:       products.weight,
  width:        products.width,
  height:       products.height,
  length:       products.length,
  images:       products.images,
  tags:         products.tags,
  status:       products.status,
  isFeatured:   products.isFeatured,
  trackInventory: products.trackInventory,
  metaTitle:    products.metaTitle,
  metaDesc:     products.metaDesc,
  createdAt:    products.createdAt,
  updatedAt:    products.updatedAt,
};

// ─── GET /api/catalog/products ────────────────────────────────────────────────
catalogRouter.get("/products", async (c) => {
  const query  = c.req.query();
  const { page, limit } = paginationSchema.parse(query);
  const { category, search, featured } = query;

  const db   = createD1Client(c.env.DB);
  const offset = (page - 1) * limit;

  const conditions = [eq(products.status, "active")];
  if (category) conditions.push(eq(products.categoryId, category));
  if (search)   conditions.push(like(products.name, `%${search}%`));
  if (featured) conditions.push(eq(products.isFeatured, true));

  const [rows, countRow] = await Promise.all([
    db.select(publicProductSelect).from(products).where(and(...conditions)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(products).where(and(...conditions)),
  ]);

  return c.json({
    success: true,
    data:    rows,
    meta:    { page, limit, total: countRow[0]?.count ?? 0 },
  });
});

// ─── GET /api/catalog/products/:slug ──────────────────────────────────────────
catalogRouter.get("/products/:slug", async (c) => {
  const { slug } = c.req.param();

  // Cache check
  const cacheKey = KV_KEYS.productCache(slug);
  const cached   = await c.env.CACHE_KV.get(cacheKey);
  if (cached) return c.json({ success: true, data: JSON.parse(cached), cached: true });

  const db      = createD1Client(c.env.DB);
  const product = await db.query.products.findFirst({
    where:   and(eq(products.slug, slug), eq(products.status, "active")),
    columns: PUBLIC_PRODUCT_COLUMNS,
    with:    {
      variants: { where: eq(productVariants.isActive, true), columns: PUBLIC_VARIANT_COLUMNS },
      category: true,
    },
  });

  if (!product) return c.json({ success: false, error: "Produk tidak ditemukan" }, 404);

  // Ambil stok total dari semua gudang
  const stockRows = await db.select({
    variantId:    inventory.variantId,
    totalAvail:   sql<number>`sum(qty_on_hand - qty_reserved)`,
  })
  .from(inventory)
  .where(eq(inventory.productId, product.id))
  .groupBy(inventory.variantId);

  const stockMap = Object.fromEntries(
    stockRows.map(r => [r.variantId ?? "__base__", Math.max(0, r.totalAvail)])
  );

  const result = { ...product, stock: stockMap };

  await c.env.CACHE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: KV_TTL.product });

  return c.json({ success: true, data: result });
});

// ─── GET /api/catalog/categories ─────────────────────────────────────────────
catalogRouter.get("/categories", async (c) => {
  const db   = createD1Client(c.env.DB);
  const rows = await db.select().from(categories).where(eq(categories.isActive, true))
    .orderBy(categories.sortOrder);
  return c.json({ success: true, data: rows });
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin: Produk
// ═══════════════════════════════════════════════════════════════════════════

// ─── POST /api/catalog/products ───────────────────────────────────────────────
catalogRouter.post("/products", requireStaff, async (c) => {
  const parsed = productInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const db  = createD1Client(c.env.DB);
  const id  = createId();
  await db.insert(products).values({ id, ...parsed.data });

  return c.json({ success: true, data: { id } }, 201);
});

// ─── PATCH /api/catalog/products/:id ──────────────────────────────────────────
catalogRouter.patch("/products/:id", requireStaff, async (c) => {
  const parsed = productUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const db      = createD1Client(c.env.DB);
  const id      = c.req.param("id");
  const current = await db.query.products.findFirst({ where: eq(products.id, id) });
  if (!current) return c.json({ success: false, error: "Produk tidak ditemukan" }, 404);

  await db.update(products).set({ ...parsed.data, updatedAt: new Date() }).where(eq(products.id, id));
  await c.env.CACHE_KV.delete(KV_KEYS.productCache(current.slug));
  if (parsed.data.slug && parsed.data.slug !== current.slug) {
    await c.env.CACHE_KV.delete(KV_KEYS.productCache(parsed.data.slug));
  }

  return c.json({ success: true });
});

// ─── DELETE /api/catalog/products/:id ─────────────────────────────────────────
// Soft delete — set status archived, bukan hapus baris (menjaga histori order_items)
catalogRouter.delete("/products/:id", requireAdmin, async (c) => {
  const db      = createD1Client(c.env.DB);
  const id      = c.req.param("id");
  const current = await db.query.products.findFirst({ where: eq(products.id, id) });
  if (!current) return c.json({ success: false, error: "Produk tidak ditemukan" }, 404);

  await db.update(products).set({ status: "archived", updatedAt: new Date() }).where(eq(products.id, id));

  await logAdminAction(db, {
    actorId: c.get("userId" as any), action: "product.archived",
    targetType: "product", targetId: id,
    metadata: { name: current.name, sku: current.sku },
  });
  await c.env.CACHE_KV.delete(KV_KEYS.productCache(current.slug));

  return c.json({ success: true });
});

// ─── POST /api/catalog/products/:id/variants ──────────────────────────────────
catalogRouter.post("/products/:id/variants", requireStaff, async (c) => {
  const parsed = variantInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const db        = createD1Client(c.env.DB);
  const productId = c.req.param("id");
  const product   = await db.query.products.findFirst({ where: eq(products.id, productId) });
  if (!product) return c.json({ success: false, error: "Produk tidak ditemukan" }, 404);

  const id = createId();
  await db.insert(productVariants).values({ id, productId, ...parsed.data });
  await c.env.CACHE_KV.delete(KV_KEYS.productCache(product.slug));

  return c.json({ success: true, data: { id } }, 201);
});

// ─── PATCH /api/catalog/products/:id/variants/:variantId ──────────────────────
catalogRouter.patch("/products/:id/variants/:variantId", requireStaff, async (c) => {
  const parsed = variantUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const db  = createD1Client(c.env.DB);
  const { id: productId, variantId } = c.req.param();
  const [product, variant] = await Promise.all([
    db.query.products.findFirst({ where: eq(products.id, productId) }),
    db.query.productVariants.findFirst({ where: eq(productVariants.id, variantId) }),
  ]);
  if (!product || !variant) return c.json({ success: false, error: "Tidak ditemukan" }, 404);

  await db.update(productVariants).set(parsed.data).where(eq(productVariants.id, variantId));
  await c.env.CACHE_KV.delete(KV_KEYS.productCache(product.slug));

  return c.json({ success: true });
});

// ─── DELETE /api/catalog/products/:id/variants/:variantId ─────────────────────
catalogRouter.delete("/products/:id/variants/:variantId", requireAdmin, async (c) => {
  const db  = createD1Client(c.env.DB);
  const { id: productId, variantId } = c.req.param();
  const product = await db.query.products.findFirst({ where: eq(products.id, productId) });
  if (!product) return c.json({ success: false, error: "Produk tidak ditemukan" }, 404);

  await db.update(productVariants).set({ isActive: false }).where(eq(productVariants.id, variantId));
  await c.env.CACHE_KV.delete(KV_KEYS.productCache(product.slug));

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin: Kategori
// ═══════════════════════════════════════════════════════════════════════════

// ─── POST /api/catalog/categories ─────────────────────────────────────────────
catalogRouter.post("/categories", requireStaff, async (c) => {
  const parsed = categoryInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const db = createD1Client(c.env.DB);
  const id = createId();
  await db.insert(categories).values({ id, ...parsed.data });

  return c.json({ success: true, data: { id } }, 201);
});

// ─── PATCH /api/catalog/categories/:id ────────────────────────────────────────
catalogRouter.patch("/categories/:id", requireStaff, async (c) => {
  const parsed = categoryUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const db = createD1Client(c.env.DB);
  const id = c.req.param("id");
  const current = await db.query.categories.findFirst({ where: eq(categories.id, id) });
  if (!current) return c.json({ success: false, error: "Kategori tidak ditemukan" }, 404);

  await db.update(categories).set(parsed.data).where(eq(categories.id, id));
  return c.json({ success: true });
});

// ─── DELETE /api/catalog/categories/:id ───────────────────────────────────────
// Soft delete — nonaktifkan, bukan hapus baris (menjaga referensi produk lama)
catalogRouter.delete("/categories/:id", requireAdmin, async (c) => {
  const db = createD1Client(c.env.DB);
  const id = c.req.param("id");
  const current = await db.query.categories.findFirst({ where: eq(categories.id, id) });
  if (!current) return c.json({ success: false, error: "Kategori tidak ditemukan" }, 404);

  await db.update(categories).set({ isActive: false }).where(eq(categories.id, id));
  return c.json({ success: true });
});
