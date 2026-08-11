import { Hono } from "hono";
import type { Env } from "../types/env";
import { createD1Client } from "@repo/db";
import { orders, payments, inventory, inventoryMovements, shipments } from "@repo/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@repo/db";
import { requireAdmin } from "../middleware/auth";
import { logAdminAction } from "../services/audit";

export const paymentRouter = new Hono<{ Bindings: Env }>();

// ─── POST /api/payment/create ─────────────────────────────────────────────────
paymentRouter.post("/create", async (c) => {
  const { orderId, gateway = "midtrans", method } =
    await c.req.json<{ orderId: string; gateway?: "midtrans" | "xendit"; method?: string }>();

  const db    = createD1Client(c.env.DB);
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    with:  { items: true },
  });

  if (!order) return c.json({ success: false, error: "Order tidak ditemukan" }, 404);
  if (order.status !== "pending_payment") {
    return c.json({ success: false, error: "Order sudah dibayar atau dibatalkan" }, 400);
  }

  const paymentId = createId();
  let result: Record<string, unknown> = {};

  if (gateway === "midtrans") {
    result = await createMidtransTransaction(c.env, order, paymentId);
  } else {
    result = await createXenditInvoice(c.env, order, paymentId);
  }

  // Simpan payment record
  await db.insert(payments).values({
    id:           paymentId,
    orderId:      order.id,
    gateway,
    gatewayTxnId: result.gatewayTxnId as string,
    method:       method ?? null,
    amount:       order.total,
    status:       "pending",
    expiredAt:    new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  return c.json({ success: true, data: { paymentId, ...result } }, 201);
});

// ─── POST /api/payment/webhook/midtrans ───────────────────────────────────────
paymentRouter.post("/webhook/midtrans", async (c) => {
  const payload = await c.req.json<{
    order_id:           string;
    transaction_status: string;
    fraud_status?:      string;
    gross_amount:       string;
    signature_key:      string;
    transaction_id:     string;
    payment_type:       string;
    va_numbers?:        Array<{ va_number: string }>;
  }>();

  // Verifikasi signature
  const signatureInput = `${payload.order_id}${payload.transaction_id ?? ""}${payload.gross_amount}${c.env.MIDTRANS_SERVER_KEY}`;
  const expectedSig    = await sha512(signatureInput);
  if (expectedSig !== payload.signature_key) {
    return c.json({ success: false, error: "Invalid signature" }, 400);
  }

  const db        = createD1Client(c.env.DB);
  const paymentId = payload.order_id; // kita set order_id = paymentId saat create

  const payment = await db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!payment) return c.json({ success: false, error: "Payment tidak ditemukan" }, 404);

  // Idempotency check
  if (payment.status === "paid") return c.json({ success: true });

  const isSuccess = (
    payload.transaction_status === "capture" ||
    payload.transaction_status === "settlement"
  ) && (payload.fraud_status !== "deny");

  const isFailed = ["cancel", "deny", "expire"].includes(payload.transaction_status);

  if (isSuccess) {
    await handlePaymentSuccess(db, c.env, payment.orderId, paymentId, payload);
  } else if (isFailed) {
    await handlePaymentFailed(db, c.env, payment.orderId, paymentId);
  }

  return c.json({ success: true });
});

// ─── POST /api/payment/webhook/xendit ────────────────────────────────────────
paymentRouter.post("/webhook/xendit", async (c) => {
  // Verifikasi Xendit webhook token
  const webhookToken = c.req.header("x-callback-token");
  if (webhookToken !== c.env.XENDIT_WEBHOOK_TOKEN) {
    return c.json({ success: false, error: "Invalid webhook token" }, 400);
  }

  const payload = await c.req.json<{
    id:          string;
    external_id: string;
    status:      string;
    paid_amount: number;
    payment_method?: string;
    paid_at?:    string;
  }>();

  const db        = createD1Client(c.env.DB);
  const paymentId = payload.external_id;

  const payment = await db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!payment) return c.json({ success: false, error: "Payment tidak ditemukan" }, 404);

  if (payment.status === "paid") return c.json({ success: true });

  if (payload.status === "PAID" || payload.status === "SETTLED") {
    await handlePaymentSuccess(db, c.env, payment.orderId, paymentId, payload);
  } else if (payload.status === "EXPIRED") {
    await handlePaymentFailed(db, c.env, payment.orderId, paymentId);
  }

  return c.json({ success: true });
});

// ─── POST /api/payment/:orderId/refund ────────────────────────────────────────
// Full refund (bukan partial per-item). Coba proses ke gateway dulu (Midtrans/
// Xendit) — kalau itu gagal, status TIDAK diubah supaya tidak mismatch antara
// catatan kita dan gateway. COD/manual tidak punya API refund, langsung update status.
paymentRouter.post("/:orderId/refund", requireAdmin, async (c) => {
  const orderId = c.req.param("orderId");
  const body    = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const reason  = body.reason;

  const db    = createD1Client(c.env.DB);
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return c.json({ success: false, error: "Order tidak ditemukan" }, 404);

  const REFUNDABLE_STATUSES = ["paid", "processing", "packed", "shipped", "delivered", "completed"];
  if (!REFUNDABLE_STATUSES.includes(order.status)) {
    return c.json({ success: false, error: `Order berstatus "${order.status}" tidak bisa di-refund` }, 400);
  }

  const payment = await db.query.payments.findFirst({
    where: and(eq(payments.orderId, orderId), eq(payments.status, "paid")),
  });
  if (!payment) return c.json({ success: false, error: "Tidak ada pembayaran berstatus paid untuk order ini" }, 400);

  try {
    if (payment.gateway === "midtrans" && payment.gatewayTxnId) {
      await refundMidtrans(c.env, payment.gatewayTxnId, order.total, reason);
    } else if (payment.gateway === "xendit" && payment.gatewayTxnId) {
      await refundXendit(c.env, payment.gatewayTxnId, order.total, reason);
    }
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : "Refund ke gateway gagal" }, 502);
  }

  await db.update(payments)
    .set({ status: "refunded", updatedAt: new Date() })
    .where(eq(payments.id, payment.id));

  await db.update(orders)
    .set({ status: "refunded", cancelReason: reason ?? "Refund oleh admin", updatedAt: new Date() })
    .where(eq(orders.id, orderId));

  // Order belum dikirim → lepas reservasi stok. Kalau sudah shipped/delivered,
  // itu retur fisik barang — restock manual lewat /warehouse/:id/inventory/adjust
  // setelah barang benar-benar diterima kembali, bukan otomatis di sini.
  if (["paid", "processing", "packed"].includes(order.status)) {
    const { releaseOrderStock } = await import("../services/inventory");
    await releaseOrderStock(db, orderId);
  }

  await logAdminAction(db, {
    actorId:    c.get("userId" as any),
    action:     "payment.refunded",
    targetType: "order",
    targetId:   orderId,
    metadata:   {
      orderNo:  order.orderNo,
      amount:   order.total,
      gateway:  payment.gateway,
      fromStatus: order.status,
      reason:   reason ?? null,
    },
  });

  await c.env.NOTIFICATION_QUEUE.send({ type: "order_refunded", orderId, paymentId: payment.id });

  return c.json({ success: true });
});

// ─── GET /api/payment/:orderId/status ─────────────────────────────────────────
paymentRouter.get("/:orderId/status", async (c) => {
  const db      = createD1Client(c.env.DB);
  const payment = await db.query.payments.findFirst({
    where: eq(payments.orderId, c.req.param("orderId")),
  });
  if (!payment) return c.json({ success: false, error: "Tidak ditemukan" }, 404);

  return c.json({ success: true, data: { status: payment.status, method: payment.method } });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function createMidtransTransaction(env: Env, order: any, paymentId: string) {
  const isProd = env.MIDTRANS_IS_PROD === "true";
  const baseUrl = isProd
    ? "https://app.midtrans.com/snap/v1/transactions"
    : "https://app.sandbox.midtrans.com/snap/v1/transactions";

  const authKey = btoa(`${env.MIDTRANS_SERVER_KEY}:`);
  const res = await fetch(baseUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${authKey}` },
    body: JSON.stringify({
      transaction_details: { order_id: paymentId, gross_amount: order.total },
      customer_details: {
        first_name: order.guestName ?? "Customer",
        email:      order.guestEmail ?? "",
        phone:      order.guestPhone ?? "",
      },
      item_details: order.items.map((i: any) => ({
        id:       i.productId,
        price:    i.priceSnapshot,
        quantity: i.qty,
        name:     i.productName.slice(0, 50),
      })),
      expiry: { unit: "hours", duration: 24 },
    }),
  });

  const data = await res.json() as { token: string; redirect_url: string };
  return {
    gatewayTxnId:   paymentId,
    snapToken:      data.token,
    snapRedirectUrl:data.redirect_url,
  };
}

async function createXenditInvoice(env: Env, order: any, paymentId: string) {
  const res = await fetch("https://api.xendit.co/v2/invoices", {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Basic ${btoa(env.XENDIT_SECRET_KEY + ":")}`,
    },
    body: JSON.stringify({
      external_id:      paymentId,
      amount:           order.total,
      payer_email:      order.guestEmail ?? "customer@email.com",
      description:      `Order ${order.orderNo}`,
      invoice_duration: 86400,
      currency:         "IDR",
      customer: {
        given_names: order.guestName ?? "Customer",
        email:       order.guestEmail,
        mobile_number: order.guestPhone,
      },
    }),
  });

  const data = await res.json() as { id: string; invoice_url: string };
  return {
    gatewayTxnId: data.id,
    invoiceUrl:   data.invoice_url,
  };
}

async function refundMidtrans(env: Env, gatewayTxnId: string, amount: number, reason?: string): Promise<void> {
  const isProd  = env.MIDTRANS_IS_PROD === "true";
  const baseUrl = isProd ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
  const authKey = btoa(`${env.MIDTRANS_SERVER_KEY}:`);

  const res = await fetch(`${baseUrl}/v2/${gatewayTxnId}/refund`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${authKey}` },
    body:    JSON.stringify({ amount, reason: reason ?? "Refund oleh admin" }),
  });

  if (!res.ok) throw new Error(`Refund Midtrans gagal (${res.status}): ${await res.text()}`);
}

async function refundXendit(env: Env, invoiceId: string, amount: number, reason?: string): Promise<void> {
  const res = await fetch("https://api.xendit.co/refunds", {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Basic ${btoa(env.XENDIT_SECRET_KEY + ":")}`,
    },
    body: JSON.stringify({
      invoice_id: invoiceId,
      amount,
      reason:     "OTHERS",
      metadata:   { note: reason ?? "Refund oleh admin" },
    }),
  });

  if (!res.ok) throw new Error(`Refund Xendit gagal (${res.status}): ${await res.text()}`);
}

async function handlePaymentSuccess(db: any, env: Env, orderId: string, paymentId: string, payload: any) {
  // Update payment status
  await db.update(payments)
    .set({ status: "paid", paidAt: new Date(), webhookPayload: payload, updatedAt: new Date() })
    .where(eq(payments.id, paymentId));

  // Update order status
  await db.update(orders)
    .set({ status: "paid", updatedAt: new Date() })
    .where(eq(orders.id, orderId));

  // Queue notifikasi
  await env.NOTIFICATION_QUEUE.send({ type: "payment_success", orderId, paymentId });
  // Queue resi polling entry
  await env.RESI_POLL_QUEUE.send({ type: "order_paid", orderId });
}

async function handlePaymentFailed(db: any, env: Env, orderId: string, paymentId: string) {
  await db.update(payments)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(payments.id, paymentId));

  await db.update(orders)
    .set({ status: "cancelled", cancelReason: "Payment failed/expired", updatedAt: new Date() })
    .where(eq(orders.id, orderId));

  // Release reserved stock
  const { releaseOrderStock } = await import("../services/inventory");
  await releaseOrderStock(db, orderId);

  await env.NOTIFICATION_QUEUE.send({ type: "payment_failed", orderId, paymentId });
}

async function sha512(input: string): Promise<string> {
  const buf    = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
