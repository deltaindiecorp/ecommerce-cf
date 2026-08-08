import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "../utils";

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id:         text("id").primaryKey().$defaultFn(createId),
  email:      text("email").notNull().unique(),
  name:       text("name"),
  phone:      text("phone"),
  password:   text("password"), // hashed, null for guest/oauth
  role:       text("role", { enum: ["customer", "admin", "staff"] }).notNull().default("customer"),
  isGuest:    integer("is_guest", { mode: "boolean" }).notNull().default(false),
  isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
  createdAt:  integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt:  integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  // Kartu "Pelanggan Baru" di dashboard:
  // WHERE role = 'customer' AND is_guest = 0 AND created_at >= ?
  roleGuestCreatedAtIdx: index("users_role_guest_created_at_idx")
    .on(t.role, t.isGuest, t.createdAt),
  // email sudah punya UNIQUE index, tidak perlu ditambah lagi.
}));

// ─── Addresses ───────────────────────────────────────────────────────────────
export const addresses = sqliteTable("addresses", {
  id:           text("id").primaryKey().$defaultFn(createId),
  userId:       text("user_id").notNull().references(() => users.id),
  label:        text("label"), // rumah, kantor
  recipientName:text("recipient_name").notNull(),
  phone:        text("phone").notNull(),
  address:      text("address").notNull(),
  district:     text("district").notNull(),
  city:         text("city").notNull(),
  province:     text("province").notNull(),
  postalCode:   text("postal_code").notNull(),
  rajaongkirCityId: integer("rajaongkir_city_id"),
  isDefault:    integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt:    integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ─── Categories ──────────────────────────────────────────────────────────────
export const categories = sqliteTable("categories", {
  id:        text("id").primaryKey().$defaultFn(createId),
  parentId:  text("parent_id"),
  name:      text("name").notNull(),
  slug:      text("slug").notNull().unique(),
  imageUrl:  text("image_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive:  integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  // GET /api/catalog/categories: WHERE is_active = 1 ORDER BY sort_order
  activeSortIdx: index("categories_active_sort_idx").on(t.isActive, t.sortOrder),
}));

// ─── Products ─────────────────────────────────────────────────────────────────
export const products = sqliteTable("products", {
  id:          text("id").primaryKey().$defaultFn(createId),
  categoryId:  text("category_id").references(() => categories.id),
  name:        text("name").notNull(),
  slug:        text("slug").notNull().unique(),
  sku:         text("sku").notNull().unique(),
  description: text("description"),
  price:       integer("price").notNull(), // dalam rupiah (sen)
  comparePrice:integer("compare_price"),   // harga coret
  // Harga modal / HPP. Nullable disengaja: NULL = "belum diisi", berbeda dari 0
  // yang berarti "modalnya memang nol". Kalau dibuat NOT NULL DEFAULT 0, semua
  // produk lama akan terbaca bermargin 100%. JANGAN pernah dikirim ke endpoint
  // publik — lihat proyeksi kolom di routes/catalog.ts.
  costPrice:   integer("cost_price"),
  weight:      integer("weight").notNull().default(0), // gram
  width:       integer("width").default(0),  // cm
  height:      integer("height").default(0),
  length:      integer("length").default(0),
  images:      text("images", { mode: "json" }).$type<string[]>().notNull().default([]),
  tags:        text("tags", { mode: "json" }).$type<string[]>().default([]),
  status:      text("status", { enum: ["active", "draft", "archived"] }).notNull().default("draft"),
  isFeatured:  integer("is_featured", { mode: "boolean" }).notNull().default(false),
  metaTitle:   text("meta_title"),
  metaDesc:    text("meta_desc"),
  createdAt:   integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt:   integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  // Daftar produk admin: filter status lalu ORDER BY created_at DESC. Prefix
  // (status) juga melayani filter status polos di katalog publik.
  statusCreatedAtIdx: index("products_status_created_at_idx").on(t.status, t.createdAt),
  // Telusur per kategori di katalog.
  categoryIdIdx: index("products_category_id_idx").on(t.categoryId),
  // Produk unggulan di beranda. Kardinalitasnya rendah, tapi berguna justru
  // karena jumlah produk unggulan sedikit dibanding total.
  isFeaturedIdx: index("products_is_featured_idx").on(t.isFeatured),
}));

// ─── Product Variants ────────────────────────────────────────────────────────
export const productVariants = sqliteTable("product_variants", {
  id:        text("id").primaryKey().$defaultFn(createId),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  name:      text("name").notNull(), // e.g. "Merah / XL"
  sku:       text("sku").notNull().unique(),
  price:     integer("price"),        // override harga produk
  costPrice: integer("cost_price"),   // override harga modal produk
  weight:    integer("weight"),       // override berat
  options:   text("options", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  imageUrl:  text("image_url"),
  isActive:  integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  // Dibaca tiap kali produk di-fetch beserta varian (halaman produk publik
  // dan halaman edit admin).
  productIdIdx: index("product_variants_product_id_idx").on(t.productId),
}));

// ─── Relations ───────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  addresses: many(addresses),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  variants: many(productVariants),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
}));
