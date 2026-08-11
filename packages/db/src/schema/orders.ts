import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "../utils";
import { users } from "./catalog";
import { warehouses } from "./warehouse";

// ─── Orders ───────────────────────────────────────────────────────────────────
export const orders = sqliteTable("orders", {
  id:          text("id").primaryKey().$defaultFn(createId),
  orderNo:     text("order_no").notNull().unique(), // INV/2025/00001

  // user_id NULL = guest checkout
  userId:      text("user_id").references(() => users.id),
  guestEmail:  text("guest_email"),   // wajib jika guest
  guestPhone:  text("guest_phone"),
  guestName:   text("guest_name"),

  status: text("status", {
    enum: ["pending_payment", "paid", "processing", "packed",
           "shipped", "delivered", "completed", "cancelled", "refunded"]
  }).notNull().default("pending_payment"),

  // Snapshot alamat saat checkout
  shippingAddress: text("shipping_address", { mode: "json" }).$type<{
    name: string; phone: string; address: string;
    district: string; city: string; province: string;
    postalCode: string; rajaongkirCityId: number;
  }>().notNull(),

  // Pricing
  subtotal:     integer("subtotal").notNull(),
  shippingCost: integer("shipping_cost").notNull().default(0),
  discount:     integer("discount").notNull().default(0),
  total:        integer("total").notNull(),

  // Metode pembayaran yang dipilih pembeli saat checkout. Sebelumnya tidak
  // pernah disimpan sama sekali — pilihan COD hilang begitu checkout selesai,
  // dan tidak ada cara membedakan order COD dari order gateway.
  paymentMethod: text("payment_method", { enum: ["midtrans", "xendit", "cod"] }),

  // Voucher
  voucherCode:  text("voucher_code"),
  voucherDiscount: integer("voucher_discount").default(0),

  // Notes
  customerNote: text("customer_note"),
  adminNote:    text("admin_note"),

  cancelReason: text("cancel_reason"),
  cancelledAt:  integer("cancelled_at", { mode: "timestamp" }),
  createdAt:    integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt:    integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  // Rentang tanggal di /api/admin/stats/overview dan urutan default daftar
  // pesanan admin (ORDER BY created_at DESC) tanpa filter.
  createdAtIdx: index("orders_created_at_idx").on(t.createdAt),
  // Daftar pesanan yang difilter status lalu diurutkan tanggal. Prefix (status)
  // juga melayani filter status polos, jadi tidak perlu index terpisah.
  statusCreatedAtIdx: index("orders_status_created_at_idx").on(t.status, t.createdAt),
  // Kartu "Pelanggan Baru" mencari pembeli yang belum pernah memesan sebelumnya
  // lewat NOT EXISTS pada kedua kolom ini. Tanpa index, tiap pemuatan dashboard
  // memindai seluruh riwayat pesanan sekali untuk tiap pembeli dalam jendela.
  //
  // Keduanya sebelumnya sengaja tidak di-index karena memang belum ada query
  // yang memakainya — alasannya yang berubah, bukan keputusannya yang keliru.
  userIdIdx:     index("orders_user_id_idx").on(t.userId),
  guestEmailIdx: index("orders_guest_email_idx").on(t.guestEmail),
}));

// ─── Order Items ──────────────────────────────────────────────────────────────
export const orderItems = sqliteTable("order_items", {
  id:          text("id").primaryKey().$defaultFn(createId),
  orderId:     text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  productId:   text("product_id").notNull(),
  variantId:   text("variant_id"),

  // Snapshot produk saat checkout (immutable)
  productName:    text("product_name").notNull(),
  variantName:    text("variant_name"),
  sku:            text("sku").notNull(),
  imageUrl:       text("image_url"),
  priceSnapshot:  integer("price_snapshot").notNull(),
  // Harga modal SAAT order dibuat. Wajib di-snapshot seperti harga jual: modal
  // berubah tiap restock, jadi tanpa ini margin historis tidak bisa dihitung
  // ulang. NULL = produk belum punya harga modal saat order ini terjadi.
  costSnapshot:   integer("cost_snapshot"),
  weightSnapshot: integer("weight_snapshot").notNull(),
  qty:            integer("qty").notNull(),
  subtotal:       integer("subtotal").notNull(),
}, (t) => ({
  // Dibaca setiap kali order di-fetch beserta relasinya, dan oleh
  // releaseOrderStock/deductOrderStock yang memuat item per order.
  orderIdIdx: index("order_items_order_id_idx").on(t.orderId),
}));

// ─── Payments ─────────────────────────────────────────────────────────────────
export const payments = sqliteTable("payments", {
  id:            text("id").primaryKey().$defaultFn(createId),
  orderId:       text("order_id").notNull().references(() => orders.id),
  gateway:       text("gateway", { enum: ["midtrans", "xendit", "cod", "manual"] }).notNull(),
  gatewayTxnId:  text("gateway_txn_id").unique(), // midtrans order_id / xendit invoice_id
  method:        text("method"),   // va_bca, qris, gopay, ovo, dana, credit_card
  vaNumber:      text("va_number"),
  amount:        integer("amount").notNull(),
  status:        text("status", {
    enum: ["pending", "paid", "failed", "expired", "refunded", "challenged"]
  }).notNull().default("pending"),
  expiredAt:     integer("expired_at", { mode: "timestamp" }),
  paidAt:        integer("paid_at", { mode: "timestamp" }),
  webhookPayload:text("webhook_payload", { mode: "json" }), // raw webhook simpan
  createdAt:     integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt:     integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  orderIdIdx: index("payments_order_id_idx").on(t.orderId),
  // Cron expirePendingPayments: WHERE status = 'pending' AND expired_at < now.
  statusExpiredAtIdx: index("payments_status_expired_at_idx").on(t.status, t.expiredAt),
}));

// ─── Shipments ────────────────────────────────────────────────────────────────
export const shipments = sqliteTable("shipments", {
  id:          text("id").primaryKey().$defaultFn(createId),
  orderId:     text("order_id").notNull().references(() => orders.id),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  courier:     text("courier").notNull(),  // jne, sicepat, jnt, pos, ninja
  service:     text("service").notNull(),  // REG, YES, OKE, BEST
  etd:         text("etd"),                // estimasi hari
  cost:        integer("cost").notNull(),
  trackingNo:  text("tracking_no"),
  labelUrl:    text("label_url"),          // R2 URL
  status:      text("status", {
    enum: ["waiting_pickup", "picked_up", "in_transit", "out_for_delivery", "delivered", "failed"]
  }).notNull().default("waiting_pickup"),
  lastStatus:  text("last_status", { mode: "json" }).$type<{
    description: string; date: string; location?: string;
  } | null>(),
  lastChecked: integer("last_checked", { mode: "timestamp" }),
  createdAt:   integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt:   integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  orderIdIdx: index("shipments_order_id_idx").on(t.orderId),
  // Cron pollActiveShipments memindai status pengiriman yang masih berjalan.
  statusIdx: index("shipments_status_idx").on(t.status),
}));

// ─── Relations ────────────────────────────────────────────────────────────────
export const ordersRelations = relations(orders, ({ one, many }) => ({
  user:     one(users, { fields: [orders.userId], references: [users.id] }),
  items:    many(orderItems),
  payments: many(payments),
  shipments:many(shipments),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order:     one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  warehouse: one(warehouses, { fields: [orderItems.warehouseId], references: [warehouses.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));

export const shipmentsRelations = relations(shipments, ({ one }) => ({
  order:     one(orders, { fields: [shipments.orderId], references: [orders.id] }),
  warehouse: one(warehouses, { fields: [shipments.warehouseId], references: [warehouses.id] }),
}));
