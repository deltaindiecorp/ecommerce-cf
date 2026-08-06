import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types/env";

// ─── StockLock Durable Object ─────────────────────────────────────────────────
// Digunakan untuk atomic stock reservation (mencegah oversell pada flash sale)
export class StockLockDurableObject extends DurableObject<Env> {
  private locks: Map<string, { qty: number; expiresAt: number }> = new Map();

  async fetch(request: Request): Promise<Response> {
    const url    = new URL(request.url);
    const action = url.pathname.slice(1); // reserve | release | check

    const body = await request.json() as {
      key: string;  // `${productId}:${variantId ?? "__base__"}:${warehouseId}`
      qty: number;
      maxQty?: number; // stok tersedia riil dari D1 (qtyAvailable - qtyReserved) saat request masuk
      ttlMs?: number;
    };

    this.cleanExpired();

    if (action === "reserve") {
      return this.reserve(body.key, body.qty, body.maxQty ?? Infinity, body.ttlMs ?? 15 * 60 * 1000);
    }
    if (action === "release") {
      return this.release(body.key, body.qty);
    }
    if (action === "check") {
      return this.check(body.key);
    }

    return new Response("Unknown action", { status: 400 });
  }

  // Karena satu instance DO memproses request secara berurutan (single-threaded),
  // pengecekan "reserved + qty > maxQty" di sini atomik lintas request concurrent —
  // ini yang mencegah oversell yang tidak bisa dijamin oleh read-then-write biasa di D1.
  private reserve(key: string, qty: number, maxQty: number, ttlMs: number): Response {
    const existing = this.locks.get(key);
    const reserved = existing?.qty ?? 0;
    const newTotal = reserved + qty;

    if (newTotal > maxQty) {
      return Response.json({ success: false, reserved, error: "Stok sedang dikunci request lain" }, { status: 409 });
    }

    this.locks.set(key, { qty: newTotal, expiresAt: Date.now() + ttlMs });

    return Response.json({ success: true, reserved: newTotal });
  }

  private release(key: string, qty: number): Response {
    const existing = this.locks.get(key);
    if (!existing) return Response.json({ success: true, reserved: 0 });

    const newQty = Math.max(0, existing.qty - qty);
    if (newQty === 0) {
      this.locks.delete(key);
    } else {
      this.locks.set(key, { ...existing, qty: newQty });
    }

    return Response.json({ success: true, reserved: newQty });
  }

  private check(key: string): Response {
    const existing = this.locks.get(key);
    return Response.json({ reserved: existing?.qty ?? 0 });
  }

  private cleanExpired() {
    const now = Date.now();
    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt < now) this.locks.delete(key);
    }
  }
}

// ─── CartDurableObject ────────────────────────────────────────────────────────
// Opsional: gunakan jika butuh konsistensi cart lebih kuat dari KV
export class CartDurableObject extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url    = new URL(request.url);
    const cartId = url.searchParams.get("cartId")!;

    if (request.method === "GET") {
      const cart = await this.ctx.storage.get(cartId);
      return Response.json({ success: true, data: cart ?? null });
    }

    if (request.method === "PUT") {
      const cart = await request.json();
      await this.ctx.storage.put(cartId, cart);
      return Response.json({ success: true });
    }

    if (request.method === "DELETE") {
      await this.ctx.storage.delete(cartId);
      return Response.json({ success: true });
    }

    return new Response("Method not allowed", { status: 405 });
  }
}
