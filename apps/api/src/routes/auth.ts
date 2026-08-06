import { Hono } from "hono";
import type { Env } from "../types/env";
import { createD1Client } from "@repo/db";
import { users } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@repo/db";
import { signJwt, verifyJwt } from "../middleware/auth";
import { KV_KEYS, KV_TTL } from "@repo/shared";
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
authRouter.post("/register", async (c) => {
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
authRouter.post("/login", async (c) => {
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

  const token = await signJwt({ sub: user.id, role: user.role }, c.env.JWT_SECRET);

  return c.json({
    success: true,
    data: { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } },
  });
});

// ─── POST /api/auth/guest/send-otp ────────────────────────────────────────────
// Kirim OTP ke email guest untuk verifikasi order status
authRouter.post("/guest/send-otp", async (c) => {
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
authRouter.post("/guest/verify-otp", async (c) => {
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

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
authRouter.get("/me", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  try {
    const payload = await verifyJwt(authHeader.slice(7), c.env.JWT_SECRET);
    return c.json({ success: true, data: payload });
  } catch {
    return c.json({ success: false, error: "Token tidak valid" }, 401);
  }
});

// ─── POST /api/auth/bootstrap-admin ──────────────────────────────────────────
// Setup admin pertama kali. Dilindungi secret (bukan requireAdmin — belum ada
// admin) DAN hanya jalan kalau belum ada satu pun user berrole admin. Setelah
// admin pertama dibuat, endpoint ini selalu menolak — pakai panel admin untuk
// menambah admin berikutnya.
authRouter.post("/bootstrap-admin", async (c) => {
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

// ─── Password helpers (Web Crypto API — CF Workers compatible) ────────────────
async function hashPassword(password: string): Promise<string> {
  const salt    = crypto.getRandomValues(new Uint8Array(16));
  const keyMat  = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits    = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    keyMat, 256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("");
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, storedHash] = stored.split(":");
  const salt    = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const keyMat  = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits    = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    keyMat, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex === storedHash;
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
