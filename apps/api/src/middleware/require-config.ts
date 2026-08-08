import { createMiddleware } from "hono/factory";
import type { Env } from "../types/env";

// Panjang minimum yang dianggap wajar untuk kunci HMAC-SHA256. Di bawah ini
// hanya diperingatkan, tidak ditolak — menolaknya bisa mengunci deployment yang
// selama ini berjalan dengan secret pendek.
const MIN_SECRET_LENGTH = 32;

// JWT_SECRET yang kosong bukan sekadar tidak aman, tapi bikin seluruh API mati:
// crypto.subtle.importKey menolak kunci sepanjang nol dengan DataError, dan itu
// muncul jauh di dalam verifyJwt sebagai "Internal server error" tanpa petunjuk
// apa pun. Dicek di depan supaya penyebabnya terbaca dari respons dan log.
//
// Ini pernah jadi masalah nyata: wrangler.toml [vars] mencantumkan JWT_SECRET = ""
// yang menimpa secret asli setiap deploy.
export const requireRuntimeConfig = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const secret = c.env.JWT_SECRET;

    if (!secret || secret.trim() === "") {
      console.error(
        "[config] JWT_SECRET kosong atau tidak diset. " +
        "Set dengan: cd apps/api && npx wrangler secret put JWT_SECRET. " +
        "Pastikan JWT_SECRET TIDAK ada di blok [vars] wrangler.toml — " +
        "nilai di sana menimpa secret."
      );
      return c.json(
        { success: false, error: "Server belum dikonfigurasi dengan benar" },
        503
      );
    }

    if (secret.length < MIN_SECRET_LENGTH) {
      console.warn(
        `[config] JWT_SECRET hanya ${secret.length} karakter. ` +
        `Disarankan minimal ${MIN_SECRET_LENGTH} untuk HMAC-SHA256.`
      );
    }

    await next();
  }
);
