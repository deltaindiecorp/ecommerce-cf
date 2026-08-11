import { Hono } from "hono";
import type { Env } from "../types/env";
import { createD1Client } from "@repo/db";
import { users } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@repo/db";
import { signJwt, verifyJwt, isRevoked } from "../middleware/auth";
import { hashPassword, verifyPassword } from "../services/password";
import { rateLimit, keyByEmailFromBody } from "../middleware/rate-limit";
import { KV_KEYS, KV_TTL, tokenTtlForRole, forgotPasswordSchema, resetPasswordSchema } from "@repo/shared";
import { z } from "zod";

export const authRouter = new Hono<{ Bindings: Env }>();

const registerSchema = z.object({
  name:     z.string().min(2),
  email:    z.string().email(),
  phone:    z.string().regex(/^(\+62|62|0)[0-9]{8,12}$/),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string(),
});

// ─── POST /api/auth/register ──────────────────────────────────────────────────
authRouter.post("/register", rateLimit({ keyPrefix: "register", limit: 5, windowSec: 3600 }), async (c) => {
  const body   = await c.req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const { name, email, phone, password } = parsed.data;
  const db = createD1Client(c.env.DB);

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing)   return c.json({ success: false, error: "Email sudah terdaftar" }, 409);

  const hashed = await hashPassword(password);
  const userId = createId();

  await db.insert(users).values({
    id: userId, email, name, phone,
    password: hashed, role: "customer",
    isGuest: false, isVerified: false,
  });

  const token = await signJwt({ sub: userId, role: "customer" }, c.env.JWT_SECRET);

  return c.json({ success: true, data: { token, user: { id: userId, name, email } } }, 201);
});

// ─── POST /api/auth/login ──────────────────────────────────────────────────────
authRouter.post("/login", rateLimit({ keyPrefix: "login", limit: 10, windowSec: 900 }), async (c) => {
  const body   = await c.req.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: "Input tidak valid" }, 400);

  const { email, password } = parsed.data;
  const db   = createD1Client(c.env.DB);
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (!user || !user.password) {
    return c.json({ success: false, error: "Email atau password salah" }, 401);
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) return c.json({ success: false, error: "Email atau password salah" }, 401);

  // Umur token mengikuti peran — sesi admin/staff jauh lebih pendek.
  const token = await signJwt(
    { sub: user.id, role: user.role },
    c.env.JWT_SECRET,
    tokenTtlForRole(user.role),
  );

  return c.json({
    success: true,
    data: { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } },
  });
});

// ─── POST /api/auth/guest/send-otp ────────────────────────────────────────────
// Kirim OTP ke email guest untuk verifikasi order status
authRouter.post("/guest/send-otp", rateLimit({
  keyPrefix: "send-otp", limit: 3, windowSec: 600, keyFn: keyByEmailFromBody,
}), async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  if (!email) return c.json({ success: false, error: "Email wajib diisi" }, 400);

  const otp    = Math.floor(100000 + Math.random() * 900000).toString();
  const otpKey = KV_KEYS.otpEmail(email);

  await c.env.SESSION_KV.put(otpKey, otp, { expirationTtl: KV_TTL.otp });

  // Kirim via Resend
  await sendOtpEmail(c.env, email, otp);

  return c.json({ success: true, message: "OTP telah dikirim ke email Anda" });
});

// ─── POST /api/auth/guest/verify-otp ─────────────────────────────────────────
authRouter.post("/guest/verify-otp", rateLimit({
  keyPrefix: "verify-otp", limit: 5, windowSec: 600, keyFn: keyByEmailFromBody,
}), async (c) => {
  const { email, otp } = await c.req.json<{ email: string; otp: string }>();
  const otpKey  = KV_KEYS.otpEmail(email);
  const storedOtp = await c.env.SESSION_KV.get(otpKey);

  if (!storedOtp || storedOtp !== otp) {
    return c.json({ success: false, error: "OTP tidak valid atau expired" }, 400);
  }

  await c.env.SESSION_KV.delete(otpKey);

  // Issue short-lived guest token (2 jam) untuk lihat order
  const token = await signJwt({ sub: email, role: "guest", email }, c.env.JWT_SECRET, 7200);

  return c.json({ success: true, data: { token } });
});

// ─── POST /api/auth/forgot-password ───────────────────────────────────────────
// Sebelumnya tidak ada pemulihan sama sekali: siapa pun yang lupa password
// terkunci permanen, termasuk admin — satu-satunya jalan adalah SQL manual ke
// D1 produksi.
//
// Balasannya SELALU sukses, terlepas email itu terdaftar atau tidak. Kalau
// dibedakan, endpoint ini jadi alat memeriksa email mana yang punya akun.
authRouter.post("/forgot-password", rateLimit({
  keyPrefix: "forgot-password", limit: 5, windowSec: 3600, keyFn: keyByEmailFromBody,
}), async (c) => {
  const parsed = forgotPasswordSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: "Email tidak valid" }, 400);

  const email = parsed.data.email.trim().toLowerCase();
  const db    = createD1Client(c.env.DB);
  const user  = await db.query.users.findFirst({ where: eq(users.email, email) });

  // Akun guest tidak punya password untuk direset.
  if (user && !user.isGuest) {
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");

    // Yang disimpan userId-nya, bukan email — kalau email berubah setelah token
    // terbit, token lama tetap menunjuk akun yang benar.
    await c.env.SESSION_KV.put(
      KV_KEYS.passwordReset(token),
      user.id,
      { expirationTtl: KV_TTL.passwordReset },
    );

    await sendPasswordResetEmail(c.env, email, token).catch(err => {
      // Kegagalan kirim tidak boleh membocorkan keberadaan akun lewat error;
      // dicatat di log supaya tetap bisa ditelusuri.
      console.error("[auth] gagal mengirim email reset:", err);
    });
  }

  return c.json({
    success: true,
    message: "Kalau email tersebut terdaftar, tautan reset sudah dikirim.",
  });
});

// ─── POST /api/auth/reset-password ────────────────────────────────────────────
authRouter.post("/reset-password", rateLimit({
  keyPrefix: "reset-password", limit: 10, windowSec: 900,
}), async (c) => {
  const parsed = resetPasswordSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const { token, password } = parsed.data;
  const key    = KV_KEYS.passwordReset(token);
  const userId = await c.env.SESSION_KV.get(key);

  if (!userId) {
    return c.json({ success: false, error: "Tautan reset tidak valid atau sudah kedaluwarsa" }, 400);
  }

  const db   = createD1Client(c.env.DB);
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return c.json({ success: false, error: "Akun tidak ditemukan" }, 404);

  await db.update(users)
    .set({ password: await hashPassword(password), updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Sekali pakai — tautan yang sama tidak bisa dipakai lagi setelah berhasil.
  await c.env.SESSION_KV.delete(key);

  return c.json({ success: true, message: "Password berhasil diubah. Silakan masuk kembali." });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
// Mencabut token yang sedang dipakai. Sebelumnya "logout" cuma menghapus cookie
// di browser — tokennya sendiri tetap sah sampai kedaluwarsa, jadi siapa pun
// yang sempat menyalinnya masih bisa memakainya berhari-hari.
//
// jti disimpan di KV sampai token itu kedaluwarsa sendiri; setelah itu entrinya
// hilang otomatis dan tidak ada yang perlu dibersihkan.
authRouter.post("/logout", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    // Tanpa token tidak ada yang perlu dicabut — tetap dianggap sukses supaya
    // logout selalu berakhir dengan pengguna keluar, bukan pesan error.
    return c.json({ success: true });
  }

  try {
    const payload = await verifyJwt(authHeader.slice(7), c.env.JWT_SECRET);
    const ttl     = payload.exp - Math.floor(Date.now() / 1000);

    if (payload.jti && ttl > 0) {
      await c.env.SESSION_KV.put(KV_KEYS.revokedToken(payload.jti), "1", { expirationTtl: Math.max(60, ttl) });
    }
  } catch {
    // Token sudah tidak valid — tidak ada yang perlu dicabut.
  }

  return c.json({ success: true });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
authRouter.get("/me", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  try {
    const payload = await verifyJwt(authHeader.slice(7), c.env.JWT_SECRET);

    // Endpoint ini memverifikasi JWT sendiri, di luar requireAuth — jadi cek
    // daftar cabut harus ikut dilakukan di sini. Tanpa itu, panel yang memakai
    // /me untuk memvalidasi sesi akan tetap menganggap token tercabut sebagai
    // sah, dan pengguna baru tertolak saat menyentuh endpoint data.
    if (await isRevoked(c.env, payload.jti)) {
      return c.json({ success: false, error: "Sesi sudah diakhiri" }, 401);
    }

    // Token guest: sub-nya email, bukan user id — tidak ada baris di tabel users
    if (payload.role === "guest") {
      return c.json({ success: true, data: payload });
    }

    const db   = createD1Client(c.env.DB);
    const user = await db.query.users.findFirst({ where: eq(users.id, payload.sub) });
    if (!user) return c.json({ success: false, error: "User tidak ditemukan" }, 404);

    return c.json({
      success: true,
      data: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch {
    return c.json({ success: false, error: "Token tidak valid" }, 401);
  }
});

// ─── POST /api/auth/bootstrap-admin ──────────────────────────────────────────
// Setup admin pertama kali. Dilindungi secret (bukan requireAdmin — belum ada
// admin) DAN hanya jalan kalau belum ada satu pun user berrole admin. Setelah
// admin pertama dibuat, endpoint ini selalu menolak — pakai panel admin untuk
// menambah admin berikutnya.
authRouter.post("/bootstrap-admin", rateLimit({ keyPrefix: "bootstrap-admin", limit: 5, windowSec: 3600 }), async (c) => {
  const secret = c.req.header("X-Bootstrap-Secret");
  if (!c.env.ADMIN_BOOTSTRAP_SECRET || secret !== c.env.ADMIN_BOOTSTRAP_SECRET) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  const db = createD1Client(c.env.DB);
  const existingAdmin = await db.query.users.findFirst({ where: eq(users.role, "admin") });
  if (existingAdmin) {
    return c.json({ success: false, error: "Admin sudah ada — endpoint ini hanya untuk setup pertama kali" }, 409);
  }

  const parsed = registerSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const { name, email, phone, password } = parsed.data;
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return c.json({ success: false, error: "Email sudah terdaftar" }, 409);

  const hashed = await hashPassword(password);
  const userId = createId();
  await db.insert(users).values({
    id: userId, email, name, phone, password: hashed,
    role: "admin", isGuest: false, isVerified: true,
  });

  const token = await signJwt({ sub: userId, role: "admin" }, c.env.JWT_SECRET);
  return c.json({ success: true, data: { token, user: { id: userId, name, email, role: "admin" } } }, 201);
});


async function sendPasswordResetEmail(env: Env, email: string, token: string) {
  if (!env.RESEND_API_KEY?.trim()) {
    throw new Error("RESEND_API_KEY belum diset — email reset tidak bisa dikirim");
  }

  // Tautan menunjuk storefront: itu alamat yang dikenal pembeli maupun admin,
  // dan halaman resetnya publik sehingga tidak butuh sesi untuk dibuka.
  const link = `${env.APP_URL}/auth/reset?token=${token}`;

  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from:    `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`,
      to:      [email],
      subject: "Reset Password",
      html:
        `<p>Kami menerima permintaan reset password untuk akun ini.</p>` +
        `<p><a href="${link}">Klik di sini untuk menyetel password baru</a></p>` +
        `<p>Tautan berlaku 30 menit dan hanya bisa dipakai sekali. ` +
        `Kalau bukan Anda yang meminta, abaikan email ini — password lama tetap berlaku.</p>`,
    }),
  });

  if (!res.ok) throw new Error(`Resend menolak (HTTP ${res.status}): ${await res.text()}`);
}

async function sendOtpEmail(env: Env, email: string, otp: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from:    `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`,
      to:      [email],
      subject: `Kode OTP Anda: ${otp}`,
      html:    `<p>Kode OTP Anda adalah: <strong>${otp}</strong>. Berlaku 10 menit.</p>`,
    }),
  });
}
