import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Env } from "../types/env";

type RateLimitOptions = {
  keyPrefix: string;
  limit:     number;
  windowSec: number;
  // Default: batasi per IP. Untuk endpoint yang menyasar satu akun/email
  // (OTP), pakai keyByEmailFromBody supaya satu penyerang tidak bisa
  // menghindar cuma dengan gonta-ganti IP.
  keyFn?: (c: Context<{ Bindings: Env }>) => Promise<string> | string;
};

// Fixed-window counter di KV. Bukan atomik sempurna (read-then-write bisa race
// di beban tinggi, mirip masalah oversell sebelum StockLockDurableObject) —
// tapi untuk anti-abuse ini cukup: tujuannya bikin brute force/spam mahal,
// bukan menjamin batas presisi. Kalau butuh presisi ketat, pindah ke Durable
// Object seperti STOCK_LOCK_DO, atau pakai Cloudflare Rate Limiting Rules
// (level WAF) begitu domain sudah live.
export function rateLimit(options: RateLimitOptions) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const identity = options.keyFn
      ? await options.keyFn(c)
      : (c.req.header("CF-Connecting-IP") ?? "unknown");
    const key = `ratelimit:${options.keyPrefix}:${identity}`;

    const current = await c.env.SESSION_KV.get(key);
    const count   = current ? parseInt(current, 10) : 0;

    if (count >= options.limit) {
      return c.json({ success: false, error: "Terlalu banyak percobaan. Coba lagi beberapa saat lagi." }, 429);
    }

    await c.env.SESSION_KV.put(key, String(count + 1), { expirationTtl: options.windowSec });
    await next();
  });
}

// Body sudah di-cache oleh Hono, jadi handler di belakang tetap bisa
// panggil c.req.json() sendiri tanpa error "body already read".
export async function keyByEmailFromBody(c: Context<{ Bindings: Env }>): Promise<string> {
  try {
    const body = await c.req.json<{ email?: string }>();
    return body.email?.trim().toLowerCase() || "no-email";
  } catch {
    return "no-email";
  }
}
