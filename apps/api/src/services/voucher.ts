import type { DbClient } from "@repo/db";
import { vouchers } from "@repo/db/schema";
import { eq, sql, and } from "drizzle-orm";

export type Voucher = typeof vouchers.$inferSelect;

export type VoucherCheckResult =
  | { valid: true; discount: number; voucher: Voucher }
  | { valid: false; error: string };

// ─── Hitung diskon (logika murni, tidak menyentuh DB) ─────────────────────────
export function computeVoucherDiscount(voucher: Voucher, subtotal: number): number {
  if (voucher.type === "fixed") {
    return Math.min(voucher.value, subtotal);
  }
  const raw = Math.floor((subtotal * voucher.value) / 100);
  return voucher.maxDiscount != null ? Math.min(raw, voucher.maxDiscount) : raw;
}

// ─── Validasi voucher terhadap subtotal & aturan berlaku ──────────────────────
export function validateVoucher(voucher: Voucher | undefined, subtotal: number, now = new Date()): VoucherCheckResult {
  if (!voucher) return { valid: false, error: "Kode voucher tidak ditemukan" };
  if (!voucher.isActive) return { valid: false, error: "Voucher tidak aktif" };
  if (voucher.startsAt && now < voucher.startsAt) return { valid: false, error: "Voucher belum berlaku" };
  if (voucher.expiresAt && now > voucher.expiresAt) return { valid: false, error: "Voucher sudah kedaluwarsa" };
  if (voucher.usageLimit != null && voucher.usageCount >= voucher.usageLimit) {
    return { valid: false, error: "Kuota voucher sudah habis" };
  }
  if (subtotal < voucher.minPurchase) {
    return { valid: false, error: `Minimal belanja Rp ${voucher.minPurchase.toLocaleString("id-ID")} untuk pakai voucher ini` };
  }

  const discount = computeVoucherDiscount(voucher, subtotal);
  return { valid: true, discount, voucher };
}

// ─── Ambil voucher by code + validasi terhadap subtotal ───────────────────────
export async function checkVoucher(db: DbClient, code: string, subtotal: number): Promise<VoucherCheckResult> {
  const voucher = await db.query.vouchers.findFirst({ where: eq(vouchers.code, code.toUpperCase()) });
  return validateVoucher(voucher, subtotal);
}

// ─── Tandai voucher terpakai (dipanggil setelah order berhasil dibuat) ────────
// Guard `usage_count < usage_limit OR usage_limit IS NULL` di WHERE supaya
// tidak overuse saat dua checkout pakai kode yang sama nyaris bersamaan.
export async function incrementVoucherUsage(db: DbClient, voucherId: string): Promise<void> {
  await db.update(vouchers)
    .set({ usageCount: sql`${vouchers.usageCount} + 1` })
    .where(and(
      eq(vouchers.id, voucherId),
      sql`(${vouchers.usageLimit} IS NULL OR ${vouchers.usageCount} < ${vouchers.usageLimit})`
    ));
}
