import type { Env } from "../types/env";
import { createD1Client } from "@repo/db";
import { shipments, orders } from "@repo/db/schema";
import { eq, inArray } from "drizzle-orm";
import { KV_KEYS, KV_TTL } from "@repo/shared";

// Dipanggil oleh Cron Trigger */30 * * * *
export async function pollActiveShipments(env: Env) {
  const db = createD1Client(env.DB);

  // Ambil semua shipment yang masih aktif
  const activeShipments = await db.select().from(shipments).where(
    inArray(shipments.status, ["waiting_pickup", "picked_up", "in_transit", "out_for_delivery"])
  );

  if (activeShipments.length === 0) return;

  // Batch ke queue untuk diproses
  const messages = activeShipments
    .filter(s => s.trackingNo)
    .map(s => ({
      body: {
        type:       "poll_resi",
        shipmentId: s.id,
        trackingNo: s.trackingNo!,
        courier:    s.courier,
        orderId:    s.orderId,
      }
    }));

  if (messages.length > 0) {
    // CF Queues send batch
    await env.RESI_POLL_QUEUE.sendBatch(messages);
  }
}

// Dipanggil oleh Queue Consumer
export async function processResiPoll(
  messages: readonly Message[],
  env: Env
) {
  const db = createD1Client(env.DB);

  for (const msg of messages) {
    const { shipmentId, trackingNo, courier, orderId } = msg.body as any;

    try {
      // Cek resi via Binderbyte
      const params = new URLSearchParams({
        api_key: env.BINDERBYTE_API_KEY,
        courier: courier ?? "auto",
        awb:     trackingNo,
      });
      const res  = await fetch(`https://api.binderbyte.com/v1/track?${params}`);
      const json = await res.json() as any;

      if (json.status !== 200 || !json.data) {
        msg.ack();
        continue;
      }

      const summary = json.data.summary;
      const history = json.data.history;
      const isDelivered = summary.status?.toLowerCase().includes("delivered") ||
                          summary.status?.toLowerCase().includes("diterima");

      const lastStatus = history[0]
        ? { description: history[0].desc, date: history[0].date, location: history[0].location }
        : null;

      // Update shipment (status cuma diubah kalau delivered — selain itu biarkan apa adanya)
      await db.update(shipments)
        .set({
          lastStatus,
          lastChecked: new Date(),
          ...(isDelivered ? { status: "delivered" as const } : {}),
          updatedAt: new Date(),
        })
        .where(eq(shipments.id, shipmentId));

      // Update resi cache
      await env.CACHE_KV.put(
        KV_KEYS.resi(trackingNo),
        JSON.stringify({ trackingNo, courier, status: summary.status, history }),
        { expirationTtl: KV_TTL.resi }
      );

      // Kalau delivered, update order status
      if (isDelivered) {
        await db.update(orders)
          .set({ status: "delivered", updatedAt: new Date() })
          .where(eq(orders.id, orderId));

        await env.NOTIFICATION_QUEUE.send({ type: "order_delivered", orderId, trackingNo });
      }

      msg.ack();
    } catch (err) {
      console.error(`Error polling resi ${trackingNo}:`, err);
      msg.retry();
    }
  }
}
