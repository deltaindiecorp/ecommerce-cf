import { Hono } from "hono";
import type { Env } from "../types/env";
import { createD1Client } from "@repo/db";
import { orders, payments, inventory, inventoryMovements, shipments } from "@repo/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@repo/db";
import { requireAuth } from "../middleware/auth";

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
