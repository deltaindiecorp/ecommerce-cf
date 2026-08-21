import { Hono } from "hono";
import type { Env } from "../types/env";
import { createD1Client } from "@repo/db";
import { orders, payments, inventory, inventoryMovements, shipments } from "@repo/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@repo/db";
import { requireAdmin, optionalAuth } from "../middleware/auth";
import { paymentCreateSchema } from "@repo/shared";
import { logAdminAction } from "../services/audit";

export const paymentRouter = new Hono<{ Bindings: Env }>();

// ─── POST /api/payment/create ─────────────────────────────────────────────────
paymentRouter.post("/create", optionalAuth, async (c) => {
  const parsed = paymentCreateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const { orderId, method } = parsed.data;

  const db    = createD1Client(c.env.DB);
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    with:  { items: true },
  });

  if (!order) return c.json({ success: false, error: "Order tidak ditemukan" }, 404);

  // Order milik pembeli terdaftar hanya boleh diproses oleh pemiliknya.
  // Order guest tidak punya pemilik yang bisa dicek — pengetahuan atas orderId
  // (UUID v4) yang jadi penjaganya, sama seperti tautan pelacakan pesanan.
  const callerId = c.get("userId" as any) as string | undefined;
  if (order.userId && order.userId !== callerId) {
    return c.json({ success: false, error: "Tidak berwenang atas pesanan ini" }, 403);
  }

  if (order.status !== "pending_payment") {
    return c.json({ success: false, error: "Order sudah dibayar atau dibatalkan" }, 400);
  }

  // Gateway mengikuti pilihan pembeli saat checkout, bukan nilai dari request
  // ini. Sebelumnya `gateway` diambil dari body tanpa divalidasi, dan nilai
  // "cod" jatuh ke cabang else — yaitu Xendit. Pembeli memilih bayar di tempat,
  // sistem malah mencoba menagih lewat gateway.
  const gateway = order.paymentMethod ?? "midtrans";
  const existing = await db.query.payments.findFirst({
    where: and(eq(payments.orderId, order.id), eq(payments.status, "pending")),
  });
  if (existing) {
    return c.json({ success: false, error: "Pembayaran untuk pesanan ini sudah dibuat" }, 409);
  }

  const paymentId = createId();

  // COD tidak melibatkan gateway sama sekali: catat saja tagihannya, penagihan
  // terjadi saat barang diserahkan.
  if (gateway === "cod") {
    await db.insert(payments).values({
      id:      paymentId,
      orderId: order.id,
      gateway: "cod",
      method:  "cod",
      amount:  order.total,
      status:  "pending",
    });

    return c.json({
      success: true,
      data: { paymentId, gateway: "cod", instruction: "Bayar tunai saat barang diterima" },
    }, 201);
  }

  let result: Record<string, unknown>;
  try {
    result = gateway === "midtrans"
      ? await createMidtransTransaction(c.env, order, paymentId)
      : await createXenditInvoice(c.env, order, paymentId);
  } catch (err) {
    // Baris payment TIDAK dibuat kalau gateway menolak. Versi lama tetap
    // membuatnya dan membalas success, sehingga pembeli mengira sudah ada
    // tagihan padahal tidak ada invoice yang benar-benar terbit.
    console.error("[payment] gagal membuat transaksi gateway:", gateway, orderId, err);
    return c.json({
      success: false,
      error: "Gagal membuat transaksi pembayaran. Coba lagi beberapa saat lagi.",
    }, 502);
  }

  // Alamat bayar disimpan, bukan cuma dikembalikan sekali. Pembeli yang menutup
  // tab lalu kembali akan ditolak 409 di atas — tanpa kolom ini, pesanannya
  // buntu sampai kedaluwarsa.
  const paymentUrl = (result.snapRedirectUrl ?? result.invoiceUrl ?? null) as string | null;

  await db.insert(payments).values({
    id:           paymentId,
    orderId:      order.id,
    gateway,
    gatewayTxnId: result.gatewayTxnId as string,
    method:       method ?? null,
    amount:       order.total,
    status:       "pending",
    paymentUrl,
    expiredAt:    new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  return c.json({ success: true, data: { paymentId, ...result } }, 201);
});

// ─── POST /api/payment/webhook/midtrans ───────────────────────────────────────
paymentRouter.post("/webhook/midtrans", async (c) => {
  const payload = await c.req.json<{
    order_id:           string;
    status_code:        string;
    transaction_status: string;
    fraud_status?:      string;
    gross_amount:       string;
    signature_key:      string;
    transaction_id:     string;
    payment_type:       string;
    va_numbers?:        Array<{ va_number: string }>;
  }>();

  // Verifikasi signature. Rumusnya memakai status_code — BUKAN transaction_id.
  //
  // Versi sebelumnya memakai transaction_id, sehingga SETIAP webhook asli dari
  // Midtrans ditolak "Invalid signature": pembeli membayar, uangnya masuk, tapi
  // pesanannya menggantung "pending" selamanya dan stoknya tidak pernah
  // dipotong. Tidak pernah ketahuan karena belum ada satu transaksi pun yang
  // sampai ke gateway — sisi klien pembayarannya sendiri belum tersambung.
  const expectedSig = await midtransSignature(
    payload.order_id, payload.status_code, payload.gross_amount, c.env.MIDTRANS_SERVER_KEY,
  );
  if (expectedSig !== payload.signature_key) {
    console.error(`[webhook] signature Midtrans tidak cocok untuk order ${payload.order_id}`);
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
  // Xendit TIDAK menandatangani isi webhook — ia hanya mengirim token statis di
  // header. Berbeda dari Midtrans, yang signature-nya mencakup gross_amount,
  // di sini tidak ada apa pun yang mengikat nominal maupun invoice mana yang
  // dimaksud. Token itu satu-satunya pintu, jadi sisanya diperiksa manual
  // terhadap catatan kita sendiri.
  if (!timingSafeEqual(c.req.header("x-callback-token") ?? "", c.env.XENDIT_WEBHOOK_TOKEN ?? "")) {
    console.error("[webhook] token Xendit tidak cocok");
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

  const verdict = xenditWebhookVerdict({
    status:            payload.status,
    invoiceId:         payload.id,
    expectedInvoiceId: payment.gatewayTxnId,
    paidAmount:        payload.paid_amount,
    expectedAmount:    payment.amount,
  });

  if (verdict.kind === "tolak") {
    console.error(`[webhook] Xendit ditolak untuk payment ${paymentId}: ${verdict.alasan}`);
    return c.json({ success: false, error: verdict.alasan }, 400);
  }

  if (verdict.kind === "lunas") {
    await handlePaymentSuccess(db, c.env, payment.orderId, paymentId, payload);
  } else if (verdict.kind === "gagal") {
    await handlePaymentFailed(db, c.env, payment.orderId, paymentId);
  }

  return c.json({ success: true });
});

export type XenditVerdict =
  | { kind: "lunas" }
  | { kind: "gagal" }
  | { kind: "abaikan" }
  | { kind: "tolak"; alasan: string };

// Dipisah jadi fungsi murni supaya bisa dikunci test: inilah yang memutuskan
// sebuah pesanan ditandai lunas, dan Xendit tidak memberi jaminan kriptografis
// apa pun atas isi webhook-nya.
export function xenditWebhookVerdict(args: {
  status:            string;
  invoiceId:         string | null | undefined;
  expectedInvoiceId: string | null | undefined;
  paidAmount:        number | null | undefined;
  expectedAmount:    number;
}): XenditVerdict {
  const status = String(args.status ?? "").toUpperCase();

  // Invoice harus yang memang kita buat. Tanpa ini, satu token yang bocor cukup
  // untuk menandai pembayaran mana pun lunas dengan menyebut external_id-nya.
  if (args.expectedInvoiceId && args.invoiceId && args.invoiceId !== args.expectedInvoiceId) {
    return { kind: "tolak", alasan: "Invoice tidak cocok dengan pembayaran ini" };
  }

  if (status === "EXPIRED") return { kind: "gagal" };
  if (status !== "PAID" && status !== "SETTLED") return { kind: "abaikan" };

  // Kurang bayar TIDAK ditandai lunas. Lebih bayar diterima — uangnya sudah
  // masuk, dan menolaknya justru meninggalkan pesanan menggantung padahal
  // pembeli sudah membayar.
  const dibayar = Number(args.paidAmount ?? 0);
  if (!Number.isFinite(dibayar) || dibayar < args.expectedAmount) {
    return {
      kind: "tolak",
      alasan: `Nominal dibayar (${dibayar}) kurang dari tagihan (${args.expectedAmount})`,
    };
  }

  return { kind: "lunas" };
}

// Perbandingan token tanpa jalan pintas panjang/isi. Selisih waktunya lewat
// jaringan memang nyaris tak terukur, tapi biayanya satu fungsi kecil.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let beda = 0;
  for (let i = 0; i < a.length; i++) beda |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return beda === 0;
}

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
paymentRouter.get("/:orderId/status", optionalAuth, async (c) => {
  const orderId = c.req.param("orderId");
  const db      = createD1Client(c.env.DB);

  // Penjaga yang sama dengan /create: order milik pembeli terdaftar hanya bisa
  // dilihat pemiliknya. Halaman pembayaran storefront memanggil ini tiap 5
  // detik untuk guest, jadi order guest tetap terbuka dengan orderId sebagai
  // penjaganya.
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return c.json({ success: false, error: "Tidak ditemukan" }, 404);

  const callerId = c.get("userId" as any) as string | undefined;
  if (order.userId && order.userId !== callerId) {
    return c.json({ success: false, error: "Tidak berwenang atas pesanan ini" }, 403);
  }

  const payment = await db.query.payments.findFirst({
    where: eq(payments.orderId, orderId),
  });
  if (!payment) return c.json({ success: false, error: "Tidak ditemukan" }, 404);

  // Ikut membawa alamat bayar, gateway, dan kedaluwarsanya: halaman tunggu perlu
  // ketiganya untuk menawarkan "lanjutkan pembayaran" tanpa membuat ulang
  // transaksi di gateway.
  return c.json({
    success: true,
    data: {
      status:     payment.status,
      method:     payment.method,
      gateway:    payment.gateway,
      paymentUrl: payment.paymentUrl,
      expiredAt:  payment.expiredAt,
    },
  });
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

  // Tanpa pemeriksaan ini, penolakan gateway berubah jadi objek berisi undefined
  // dan tetap dilaporkan sukses ke pembeli. Fungsi refund di berkas ini sudah
  // memeriksanya sejak awal — di sini terlewat.
  if (!res.ok) {
    throw new Error(`Midtrans menolak transaksi (HTTP ${res.status}): ${await res.text()}`);
  }

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

  if (!res.ok) {
    throw new Error(`Xendit menolak invoice (HTTP ${res.status}): ${await res.text()}`);
  }

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

// Rumus resmi Midtrans: SHA512(order_id + status_code + gross_amount + ServerKey).
// Dipisah jadi fungsi tersendiri supaya bisa dikunci test dengan vektor yang
// dihitung di luar kode ini — rumus yang salah membuat seluruh webhook ditolak,
// dan gejalanya (pesanan menggantung) tidak menunjuk ke sini sama sekali.
export async function midtransSignature(
  orderId: string, statusCode: string, grossAmount: string, serverKey: string,
): Promise<string> {
  return sha512(`${orderId}${statusCode}${grossAmount}${serverKey}`);
}

async function sha512(input: string): Promise<string> {
  const buf    = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
