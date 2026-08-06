import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createId } from "../utils";

// ─── Vouchers ────────────────────────────────────────────────────────────────
export const vouchers = sqliteTable("vouchers", {
  id:          text("id").primaryKey().$defaultFn(createId),
  code:        text("code").notNull().unique(), // disimpan uppercase
  type:        text("type", { enum: ["percentage", "fixed"] }).notNull(),
  value:       integer("value").notNull(), // percentage: 1-100, fixed: rupiah
  minPurchase: integer("min_purchase").notNull().default(0),
  maxDiscount: integer("max_discount"), // cap untuk type percentage, null = tanpa cap
  usageLimit:  integer("usage_limit"),  // null = unlimited
  usageCount:  integer("usage_count").notNull().default(0),
  isActive:    integer("is_active", { mode: "boolean" }).notNull().default(true),
  startsAt:    integer("starts_at", { mode: "timestamp" }),
  expiresAt:   integer("expires_at", { mode: "timestamp" }),
  createdAt:   integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
