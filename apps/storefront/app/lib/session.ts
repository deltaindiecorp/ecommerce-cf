import { TOKEN_TTL_SEC } from "@repo/shared";

export const AUTH_COOKIE = "auth_token";

// Umur cookie disamakan dengan umur token pelanggan dari API. Kalau keduanya
// berbeda, token tetap sah setelah browser berhenti mengirimkannya.
const MAX_AGE = TOKEN_TTL_SEC.customer;

// `Secure` mencegah cookie ikut terkirim lewat koneksi polos. Browser
// memperlakukan http://localhost sebagai konteks aman, jadi tidak merusak dev.
const FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax";

export function getAuthToken(request: Request): string {
  return request.headers.get("Cookie")?.match(/auth_token=([^;]+)/)?.[1] ?? "";
}

export function authCookie(token: string): string {
  return `${AUTH_COOKIE}=${token}; ${FLAGS}; Max-Age=${MAX_AGE}`;
}

export function clearedAuthCookie(): string {
  return `${AUTH_COOKIE}=; ${FLAGS}; Max-Age=0`;
}
