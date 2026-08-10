import { Hono } from "hono";
import type { Env } from "../types/env";
import { optionalAuth } from "../middleware/auth";
import { addToCartSchema, KV_KEYS, KV_TTL } from "@repo/shared";
import type { Cart, CartItem } from "@repo/shared";
import { createD1Client } from "@repo/db";
import { products, productVariants, inventory } from "@repo/db/schema";
import { eq, and } from "drizzle-orm";

export const cartRouter = new Hono<{ Bindings: Env }>();

// ─── GET /api/cart ─────────────────────────────────────────────────────────────
cartRouter.get("/", optionalAuth, async (c) => {
  const cartId = c.req.header("X-Cart-Id") ?? c.get("cartId");
  if (!cartId) return c.json({ success: true, data: null });

  const raw = await c.env.CART_KV.get(KV_KEYS.cart(cartId));
  if (!raw) return c.json({ success: true, data: null });

  return c.json({ success: true, data: JSON.parse(raw) as Cart });
});

// ─── POST /api/cart/add ───────────────────────────────────────────────────────
cartRouter.post("/add", optionalAuth, async (c) => {
  const body   = await c.req.json();
  const parsed = addToCartSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.flatten() }, 400);
  }

  const { productId, variantId, qty } = parsed.data;
  const db = createD1Client(c.env.DB);

  // Ambil data produk
  const product = await db.query.products.findFirst({
    where: eq(products.id, productId),
    with:  { variants: true },
  });
  if (!product || product.status !== "active") {
    return c.json({ success: false, error: "Produk tidak tersedia" }, 404);
  }

  const variant = variantId
    ? product.variants.find(v => v.id === variantId)
    : undefined;

  const price  = variant?.price ?? product.price;
  const weight = variant?.weight ?? product.weight;
  const sku    = variant?.sku ?? product.sku;

  // Cek stok (aggregate semua warehouse)
  const stockRows = await db.select()
    .from(inventory)
    .where(variantId
      ? and(eq(inventory.productId, productId), eq(inventory.variantId, variantId))
      : eq(inventory.productId, productId)
    );

  const totalStock = stockRows.reduce((s, r) => s + r.qtyOnHand - r.qtyReserved, 0);
  if (totalStock < qty) {
    return c.json({ success: false, error: `Stok tidak cukup. Tersisa: ${totalStock}` }, 400);
  }

  // Ambil / buat cart
  const cartId  = c.req.header("X-Cart-Id") ?? crypto.randomUUID();
  const cartKey = KV_KEYS.cart(cartId);
  const rawCart = await c.env.CART_KV.get(cartKey);
  const cart: Cart = rawCart ? JSON.parse(rawCart) : {
    id:        cartId,
    userId:    c.get("userId"),
    items:     [],
    subtotal:  0,
    itemCount: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + KV_TTL.cart * 1000).toISOString(),
  };

  // Update item di cart
  const existIdx = cart.items.findIndex(
    i => i.productId === productId && i.variantId === variantId
  );
  if (existIdx >= 0) {
    cart.items[existIdx].qty     += qty;
    cart.items[existIdx].subtotal = cart.items[existIdx].qty * price;
  } else {
    cart.items.push({
      productId, variantId,
      productName: product.name,
      variantName: variant?.name,
      sku, imageUrl: variant?.imageUrl ?? product.images[0],
      price, weight, qty,
      subtotal: price * qty,
    } as CartItem);
  }

  cart.subtotal  = cart.items.reduce((s, i) => s + i.subtotal, 0);
  cart.itemCount = cart.items.reduce((s, i) => s + i.qty, 0);

  await c.env.CART_KV.put(cartKey, JSON.stringify(cart), { expirationTtl: KV_TTL.cart });

  return c.json({ success: true, data: cart, cartId }, 201);
});

// ─── PATCH /api/cart/item/:productId ─────────────────────────────────────────
cartRouter.patch("/item/:productId", optionalAuth, async (c) => {
  const { productId } = c.req.param();
  const { qty, variantId } = await c.req.json<{ qty: number; variantId?: string }>();
  const cartId = c.req.header("X-Cart-Id");
  if (!cartId) return c.json({ success: false, error: "Cart tidak ditemukan" }, 404);

  const raw = await c.env.CART_KV.get(KV_KEYS.cart(cartId));
  if (!raw)  return c.json({ success: false, error: "Cart tidak ditemukan" }, 404);

  const cart: Cart = JSON.parse(raw);
  const idx = cart.items.findIndex(
    i => i.productId === productId && i.variantId === variantId
  );
  if (idx < 0) return c.json({ success: false, error: "Item tidak ada di cart" }, 404);

  if (qty <= 0) {
    cart.items.splice(idx, 1);
  } else {
    cart.items[idx].qty      = qty;
    cart.items[idx].subtotal = cart.items[idx].price * qty;
  }

  cart.subtotal  = cart.items.reduce((s, i) => s + i.subtotal, 0);
  cart.itemCount = cart.items.reduce((s, i) => s + i.qty, 0);

  await c.env.CART_KV.put(KV_KEYS.cart(cartId), JSON.stringify(cart), { expirationTtl: KV_TTL.cart });

  return c.json({ success: true, data: cart });
});

// ─── DELETE /api/cart/clear ───────────────────────────────────────────────────
cartRouter.delete("/clear", async (c) => {
  const cartId = c.req.header("X-Cart-Id");
  if (cartId) await c.env.CART_KV.delete(KV_KEYS.cart(cartId));
  return c.json({ success: true });
});
