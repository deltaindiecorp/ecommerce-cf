import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "../utils";
import { users } from "./catalog";

// ─── Admin Audit Log ──────────────────────────────────────────────────────────
// Sebelumnya tidak ada catatan sama sekali tentang siapa melakukan apa di panel.
// Refund, perubahan status order, penghapusan produk, penonaktifan gudang —
// semuanya hanya meninggalkan hasil akhirnya di baris yang diubah, tanpa jejak
// pelakunya. Untuk platform yang memegang uang orang, itu masalah pada sengketa
// pertama.
//
// Ini melengkapi inventory_movements, bukan menggantikannya: movements mencatat
// pergerakan stok, tabel ini mencatat keputusan admin.
export const adminAuditLog = sqliteTable("admin_audit_log", {
  id:      text("id").primaryKey().$defaultFn(createId),

  // NULL hanya untuk aksi yang dipicu sistem. Tidak pakai onDelete cascade:
  // menghapus user tidak boleh ikut menghapus jejak tindakannya.
  actorId:   text("actor_id").references(() => users.id),
  actorName: text("actor_name"), // snapshot, supaya tetap terbaca kalau user berubah/terhapus
  actorRole: text("actor_role"),

  action:     text("action").notNull(),      // order.status_changed, payment.refunded, ...
  targetType: text("target_type").notNull(), // order, product, warehouse, voucher
  targetId:   text("target_id"),

  // Konteks secukupnya untuk memahami aksi tanpa menelusuri tabel lain —
  // mis. { from: "paid", to: "cancelled" } atau { amount: 150000 }.
  metadata:  text("metadata", { mode: "json" }).$type<Record<string, unknown> | null>(),

  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  // Riwayat satu objek (mis. semua aksi pada satu order) — tampilan paling sering.
  targetIdx:    index("admin_audit_target_idx").on(t.targetType, t.targetId, t.createdAt),
  // Feed global terbaru, dan penelusuran per orang.
  createdAtIdx: index("admin_audit_created_at_idx").on(t.createdAt),
  actorIdx:     index("admin_audit_actor_idx").on(t.actorId, t.createdAt),
}));

export const adminAuditLogRelations = relations(adminAuditLog, ({ one }) => ({
  actor: one(users, { fields: [adminAuditLog.actorId], references: [users.id] }),
}));
