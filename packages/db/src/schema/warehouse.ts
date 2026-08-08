import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "../utils";
import { products, productVariants } from "./catalog";

// ─── Warehouses ───────────────────────────────────────────────────────────────
export const warehouses = sqliteTable("warehouses", {
  id:              text("id").primaryKey().$defaultFn(createId),
  name:            text("name").notNull(),
  code:            text("code").notNull().unique(), // JKT, SBY, MDN
  address:         text("address").notNull(),
  city:            text("city").notNull(),
  province:        text("province").notNull(),
  postalCode:      text("postal_code").notNull(),
  rajaongkirCityId:integer("rajaongkir_city_id").notNull(),
  phone:           text("phone"),
  picName:         text("pic_name"),      // penanggung jawab
  isActive:        integer("is_active", { mode: "boolean" }).notNull().default(true),
  priority:        integer("priority").notNull().default(1), // 1 = highest
  createdAt:       integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  // Routing checkout: WHERE is_active = 1 ORDER BY priority. Dijalankan sekali
  // per checkout, sebelum loop item.
  activePriorityIdx: index("warehouses_active_priority_idx").on(t.isActive, t.priority),
}));

// ─── Inventory ────────────────────────────────────────────────────────────────
export const inventory = sqliteTable("inventory", {
  id:          text("id").primaryKey().$defaultFn(createId),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  productId:   text("product_id").notNull().references(() => products.id),
  variantId:   text("variant_id").references(() => productVariants.id), // null = no variant
  qtyAvailable:integer("qty_available").notNull().default(0),
  qtyReserved: integer("qty_reserved").notNull().default(0),   // locked by pending orders
  qtyOnHand:   integer("qty_on_hand").notNull().default(0),    // physical stock
  lowStockAlert:integer("low_stock_alert").notNull().default(5),
  updatedAt:   integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  // Lookup terpanas di sistem: dipakai reserve saat checkout, release, deduct,
  // dan penyesuaian stok — semuanya lewat inventoryRowFilter(). Prefix
  // (warehouse_id) sekaligus melayani daftar inventaris per gudang dan cek
  // sisa stok saat gudang dinonaktifkan.
  whProductVariantIdx: index("inventory_wh_product_variant_idx")
    .on(t.warehouseId, t.productId, t.variantId),
  // Agregasi stok lintas gudang di halaman produk publik:
  // WHERE product_id = ? GROUP BY variant_id. Tidak terlayani index di atas
  // karena kolom pertamanya warehouse_id.
  productIdIdx: index("inventory_product_id_idx").on(t.productId),
}));

// ─── Inventory Movements ──────────────────────────────────────────────────────
export const inventoryMovements = sqliteTable("inventory_movements", {
  id:          text("id").primaryKey().$defaultFn(createId),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  productId:   text("product_id").notNull().references(() => products.id),
  variantId:   text("variant_id"),
  type:        text("type", {
    enum: ["in", "out", "reserve", "release", "transfer_in", "transfer_out", "adjustment"]
  }).notNull(),
  qty:         integer("qty").notNull(),
  refType:     text("ref_type"), // order, transfer, adjustment
  refId:       text("ref_id"),   // order_id, transfer_id
  note:        text("note"),
  createdAt:   integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  // Cek idempotensi di releaseOrderStock/deductOrderStock:
  // WHERE ref_type = 'order' AND ref_id = ? AND type = ?
  refIdx: index("inventory_movements_ref_idx").on(t.refType, t.refId, t.type),
}));

// ─── Warehouse Transfers ──────────────────────────────────────────────────────
export const warehouseTransfers = sqliteTable("warehouse_transfers", {
  id:            text("id").primaryKey().$defaultFn(createId),
  fromWarehouse: text("from_warehouse").notNull().references(() => warehouses.id),
  toWarehouse:   text("to_warehouse").notNull().references(() => warehouses.id),
  productId:     text("product_id").notNull().references(() => products.id),
  variantId:     text("variant_id"),
  qty:           integer("qty").notNull(),
  status:        text("status", { enum: ["pending", "in_transit", "completed", "cancelled"] }).notNull().default("pending"),
  requestedBy:   text("requested_by"),
  note:          text("note"),
  createdAt:     integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt:   integer("completed_at", { mode: "timestamp" }),
});

// ─── Relations ────────────────────────────────────────────────────────────────
export const warehousesRelations = relations(warehouses, ({ many }) => ({
  inventory: many(inventory),
  movements: many(inventoryMovements),
}));

export const inventoryRelations = relations(inventory, ({ one }) => ({
  warehouse: one(warehouses, { fields: [inventory.warehouseId], references: [warehouses.id] }),
  product:   one(products, { fields: [inventory.productId], references: [products.id] }),
}));
