import { createMiddleware } from "hono/factory";
import type { Env } from "../types/env";
import { KV_KEYS } from "@repo/shared";

type Variables = {
  userId?:   string;
  userRole?: string;
  isGuest:   boolean;
  cartId?:   string;
};

// ─── Optional Auth (user or guest) ────────────────────────────────────────────
export const optionalAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    const cartId     = c.req.header("X-Cart-Id");

    c.set("isGuest", true);
    if (cartId) c.set("cartId", cartId);

    if (authHeader?.startsWith("Bearer ")) {
      try {
        const token   = authHeader.slice(7);
        const payload = await verifyJwt(token, c.env.JWT_SECRET);
        c.set("userId",   payload.sub);
        c.set("userRole", payload.role);
        c.set("isGuest",  false);
      } catch {
        // Token invalid — lanjut sebagai guest
      }
    }

    await next();
  }
);

// ─── Required Auth ────────────────────────────────────────────────────────────
export const requireAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    try {
      const token   = authHeader.slice(7);
      const payload = await verifyJwt(token, c.env.JWT_SECRET);
      c.set("userId",   payload.sub);
      c.set("userRole", payload.role);
      c.set("isGuest",  false);
    } catch {
      return c.json({ success: false, error: "Token tidak valid atau expired" }, 401);
    }
    await next();
  }
);

// ─── Admin Only ───────────────────────────────────────────────────────────────
export const requireAdmin = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    await requireAuth(c, async () => {});
    const role = c.get("userRole");
    if (role !== "admin" && role !== "staff") {
      return c.json({ success: false, error: "Forbidden" }, 403);
    }
    await next();
  }
);

// ─── JWT Helpers ──────────────────────────────────────────────────────────────
export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSec = 7 * 24 * 3600
): Promise<string> {
  const header  = { alg: "HS256", typ: "JWT" };
  const now     = Math.floor(Date.now() / 1000);
  const body    = { ...payload, iat: now, exp: now + expiresInSec };

  const enc     = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const data    = `${enc(header)}.${enc(body)}`;
  const key     = await importHmacKey(secret);
  const sig     = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const sigB64  = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  return `${data}.${sigB64}`;
}

export async function verifyJwt(
  token: string,
  secret: string
): Promise<{ sub: string; role: string; exp: number }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");

  const [headerB64, bodyB64, sigB64] = parts;
  const data    = `${headerB64}.${bodyB64}`;
  const key     = await importHmacKey(secret);

  const sigBuf  = Uint8Array.from(atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const valid   = await crypto.subtle.verify("HMAC", key, sigBuf, new TextEncoder().encode(data));
  if (!valid) throw new Error("Invalid signature");

  const payload = JSON.parse(atob(bodyB64.replace(/-/g, "+").replace(/_/g, "/")));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");

  return payload;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
