import type { DbClient } from "@repo/db";
import { adminAuditLog, users } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@repo/db";

// ─── Pencatatan Aksi Admin ────────────────────────────────────────────────────
// Dipanggil setelah aksinya berhasil, bukan sebelum — supaya log tidak memuat
// tindakan yang sebenarnya gagal di tengah jalan.
//
// Kegagalan pencatatan TIDAK boleh menggagalkan aksinya. Refund yang sudah
// berhasil masuk ke gateway tidak boleh dilaporkan gagal hanya karena baris
// audit-nya tidak tertulis; kesalahannya dicatat ke log Worker sebagai gantinya.

export type AuditAction =
  | "order.status_changed"
  | "order.shipment_created"
  | "payment.refunded"
  | "product.archived"
  | "product.created"
  | "warehouse.created"
  | "warehouse.updated"
  | "warehouse.deactivated"
  | "voucher.created"
  | "voucher.deactivated"
  | "settings.updated"
  | "user.created"
  | "user.updated";

export type AuditEntry = {
  actorId?:   string | null;
  action:     AuditAction;
  targetType: "order" | "product" | "warehouse" | "voucher" | "payment" | "settings" | "user";
  targetId?:  string | null;
  metadata?:  Record<string, unknown> | null;
};

export async function logAdminAction(db: DbClient, entry: AuditEntry): Promise<void> {
  try {
    // Nama & peran di-snapshot supaya baris audit tetap terbaca kalau
    // pengguna berganti nama atau akunnya dihapus di kemudian hari.
    let actorName: string | null = null;
    let actorRole: string | null = null;

    if (entry.actorId) {
      const actor = await db.query.users.findFirst({
        where:   eq(users.id, entry.actorId),
        columns: { name: true, role: true },
      });
      actorName = actor?.name ?? null;
      actorRole = actor?.role ?? null;
    }

    await db.insert(adminAuditLog).values({
      id:         createId(),
      actorId:    entry.actorId ?? null,
      actorName,
      actorRole,
      action:     entry.action,
      targetType: entry.targetType,
      targetId:   entry.targetId ?? null,
      metadata:   entry.metadata ?? null,
    });
  } catch (err) {
    console.error("[audit] gagal mencatat aksi admin:", entry.action, entry.targetId, err);
  }
}
