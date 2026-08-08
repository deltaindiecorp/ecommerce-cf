import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "./types/env";
import { requireRuntimeConfig } from "./middleware/require-config";

// Routes
import { catalogRouter }  from "./routes/catalog";
import { cartRouter }     from "./routes/cart";
import { checkoutRouter } from "./routes/checkout";
import { paymentRouter }  from "./routes/payment";
import { warehouseRouter } from "./routes/warehouse";
import { shippingRouter } from "./routes/shipping";
import { authRouter }     from "./routes/auth";
import { adminRouter }    from "./routes/admin";
import { uploadRouter }   from "./routes/upload";
import { voucherAdminRouter } from "./routes/vouchers";

// Durable Objects (export required by Cloudflare)
export { CartDurableObject, StockLockDurableObject } from "./durable-objects/stock-lock-do";

const app = new Hono<{ Bindings: Env }>();

// ─── Global Middleware ────────────────────────────────────────────────────────
app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", prettyJSON());
app.use("/api/*", (c, next) =>
  cors({
    origin: c.env.CORS_ORIGINS.split(",").map(o => o.trim()),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Cart-Id"],
    credentials: true,
  })(c, next)
);

// ─── Health Check ─────────────────────────────────────────────────────────────
// Sengaja di atas requireRuntimeConfig supaya health check tetap menjawab dan
// bisa dipakai memastikan Worker-nya hidup, terpisah dari status konfigurasi.
app.get("/", (c) => c.json({ status: "ok", service: "ecommerce-api", ts: Date.now() }));

// ─── Config Guard ─────────────────────────────────────────────────────────────
// Menolak semua request /api/* kalau secret wajib belum diset, dengan pesan yang
// menjelaskan penyebabnya — bukan DataError dari Web Crypto di tengah request.
app.use("/api/*", requireRuntimeConfig);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.route("/api/auth",      authRouter);
app.route("/api/catalog",   catalogRouter);
app.route("/api/cart",      cartRouter);
app.route("/api/checkout",  checkoutRouter);
app.route("/api/payment",   paymentRouter);
app.route("/api/warehouse", warehouseRouter);
app.route("/api/shipping",  shippingRouter);
app.route("/api/admin",     adminRouter);
app.route("/api/upload",    uploadRouter);
app.route("/api/admin/vouchers", voucherAdminRouter);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ success: false, error: "Route tidak ditemukan" }, 404));

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ success: false, error: "Internal server error" }, 500);
});

// ─── Cron Triggers ────────────────────────────────────────────────────────────
async function handleCron(event: ScheduledEvent, env: Env) {
  const { cron: cronTab } = event;

  if (cronTab === "*/30 * * * *") {
    // Poll resi untuk semua shipment aktif
    const { pollActiveShipments } = await import("./jobs/resi-poller");
    await pollActiveShipments(env);
  }

  if (cronTab === "0 * * * *") {
    // Expire pending payments
    const { expirePendingPayments } = await import("./jobs/notifications");
    await expirePendingPayments(env);
  }

  if (cronTab === "0 0 * * *") {
    // Cleanup guest sessions
    const { cleanupGuestSessions } = await import("./jobs/notifications");
    await cleanupGuestSessions(env);
  }
}

// ─── Queue Consumer ──────────────────────────────────────────────────────────
async function handleQueue(batch: MessageBatch, env: Env) {
  if (batch.queue === "notification-queue") {
    const { processNotifications } = await import("./jobs/notifications");
    await processNotifications(batch.messages, env);
  }

  if (batch.queue === "resi-poll-queue") {
    const { processResiPoll } = await import("./jobs/resi-poller");
    await processResiPoll(batch.messages, env);
  }
}

export default {
  fetch:     app.fetch,
  scheduled: handleCron,
  queue:     handleQueue,
};
