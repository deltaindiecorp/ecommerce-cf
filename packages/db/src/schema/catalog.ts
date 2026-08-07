import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
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
});

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
});

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
});

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
});

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
