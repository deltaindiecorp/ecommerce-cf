import { useRouteLoaderData } from "@remix-run/react";
import { TOKEN_TTL_SEC } from "@repo/shared";

export const ADMIN_COOKIE = "admin_token";

// Umur cookie disamakan dengan umur token. Sebelumnya cookie 1 hari sementara
// token sah 7 hari, jadi token tetap berlaku enam hari setelah browser berhenti
// mengirimkannya — selisih yang tidak terlihat siapa pun sampai token bocor.
const MAX_AGE = TOKEN_TTL_SEC.admin;

// `Secure` membuat cookie tidak pernah ikut terkirim lewat koneksi polos.
// Browser memperlakukan http://localhost sebagai konteks aman, jadi flag ini
// tidak merusak pengembangan lokal.
//
// `SameSite=Lax` dipertahankan: cukup untuk menahan POST lintas situs (CSRF)
// tanpa memutus tautan masuk biasa.
const FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax";

export function sessionCookie(token: string): string {
  return `${ADMIN_COOKIE}=${token}; ${FLAGS}; Max-Age=${MAX_AGE}`;
}

export function clearedSessionCookie(): string {
  return `${ADMIN_COOKIE}=; ${FLAGS}; Max-Age=0`;
}

// Peran yang boleh masuk panel sama sekali. `staff` termasuk — API memang
// mengizinkannya untuk operasi harian; yang membedakan admin adalah tindakan
// sulit dibatalkan (refund, hapus, kelola gudang & voucher).
export const PANEL_ROLES = ["admin", "staff"];

export function isAdminRole(role?: string | null): boolean {
  return role === "admin";
}

// Peran pengguna yang sedang masuk, dibaca dari loader root. Dipakai untuk
// menyembunyikan aksi yang akan ditolak API — bukan sebagai pengaman: yang
// menegakkan tetap requireAdmin di sisi server.
export function useAdminRole(): string | undefined {
  const data = useRouteLoaderData("root") as { user?: { role?: string } } | undefined;
  return data?.user?.role;
}
