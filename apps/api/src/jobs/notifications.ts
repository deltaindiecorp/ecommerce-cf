import type { Env } from "../types/env";
import { createD1Client } from "@repo/db";
import { orders, payments } from "@repo/db/schema";
import { eq, lt, and } from "drizzle-orm";
import { releaseOrderStock } from "../services/inventory";

// ─── Process Notification Queue ───────────────────────────────────────────────
export async function processNotifications(messages: readonly Message[], env: Env) {
  const db = createD1Client(env.DB);

  for (const msg of messages) {
    const { type, orderId, email, userId } = msg.body as any;

    try {
      const order = orderId
        ? await db.query.orders.findFirst({ where: eq(orders.id, orderId), with: { items: true } })
        : null;

      const recipientEmail = email ?? order?.guestEmail;
      if (!recipientEmail) { msg.ack(); continue; }

      switch (type) {
        case "order_created":
          await sendEmail(env, recipientEmail, `Pesanan ${order?.orderNo} Berhasil Dibuat`, `
            <h2>Terima kasih telah berbelanja!</h2>
            <p>Nomor pesanan Anda: <strong>${order?.orderNo}</strong></p>
            <p>Total: <strong>Rp ${order?.total?.toLocaleString("id-ID")}</strong></p>
            <p>Silakan selesaikan pembayaran dalam 24 jam.</p>
          `);
          break;

        case "payment_success":
          await sendEmail(env, recipientEmail, `Pembayaran ${order?.orderNo} Berhasil`, `
            <h2>Pembayaran Diterima!</h2>
            <p>Pesanan <strong>${order?.orderNo}</strong> sedang kami proses.</p>
            <p>Kami akan segera mengirimkan paket Anda.</p>
          `);
          break;

        case "payment_failed":
          await sendEmail(env, recipientEmail, `Pembayaran ${order?.orderNo} Gagal`, `
            <h2>Pembayaran Gagal</h2>
            <p>Pesanan <strong>${order?.orderNo}</strong> telah dibatalkan karena pembayaran tidak berhasil.</p>
          `);
          break;

        case "order_shipped":
          const { trackingNo, courier } = msg.body as any;
          await sendEmail(env, recipientEmail, `Pesanan ${order?.orderNo} Dikirim`, `
            <h2>Pesanan Dalam Perjalanan!</h2>
            <p>No. Resi: <strong>${trackingNo}</strong> (${courier?.toUpperCase()})</p>
            <p>Cek resi: <a href="${env.APP_URL}/track/${trackingNo}">Klik di sini</a></p>
          `);
          break;

        case "order_delivered":
          await sendEmail(env, recipientEmail, `Pesanan ${order?.orderNo} Telah Diterima`, `
            <h2>Paket Telah Diterima!</h2>
            <p>Terima kasih telah berbelanja. Jangan lupa berikan ulasan produk Anda.</p>
          `);
          break;
      }

      msg.ack();
    } catch (err) {
      console.error("Notification error:", err);
      msg.retry();
    }
  }
}

// ─── Expire Pending Payments (Cron) ──────────────────────────────────────────
export async function expirePendingPayments(env: Env) {
  const db  = createD1Client(env.DB);
  const now = new Date();

  const expired = await db.select().from(payments).where(
    and(
      eq(payments.status, "pending"),
      lt(payments.expiredAt!, now)
    )
  );

  for (const payment of expired) {
    await db.update(payments)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(payments.id, payment.id));

    await db.update(orders)
      .set({ status: "cancelled", cancelReason: "Payment expired", updatedAt: new Date() })
      .where(eq(orders.id, payment.orderId));

    await releaseOrderStock(db, payment.orderId);
  }
}

// ─── Cleanup Guest Sessions (Cron Daily) ─────────────────────────────────────
export async function cleanupGuestSessions(_env: Env) {
  // KV TTL handles expiry automatically
  // Cleanup expired guest users di D1 jika perlu
  console.log("Guest session cleanup — handled by KV TTL");
}

// ─── Email via Resend ─────────────────────────────────────────────────────────
async function sendEmail(env: Env, to: string, subject: string, html: string) {
  await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from:    `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`,
      to:      [to],
      subject, html,
    }),
  });
}
