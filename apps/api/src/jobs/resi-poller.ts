import type { Env } from "../types/env";
import { createD1Client } from "@repo/db";
import { shipments, orders } from "@repo/db/schema";
import { eq, inArray } from "drizzle-orm";
import { KV_KEYS, KV_TTL, isResiPollDue } from "@repo/shared";
import { trackWaybill, isDelivered } from "../services/tracking";
import { deductOrderStock } from "../services/inventory";

// Dipanggil oleh Cron Trigger */30 * * * *
export async function pollActiveShipments(env: Env) {
  const db = createD1Client(env.DB);

  // Ambil semua shipment yang masih aktif
  const activeShipments = await db.select().from(shipments).where(
    inArray(shipments.status, ["waiting_pickup", "picked_up", "in_transit", "out_for_delivery"])
  );

  if (activeShipments.length === 0) return;

  // Penyaring inilah yang menentukan tagihan Binderbyte. Tiap panggilan berbiaya
  // 15 credit; sebelumnya SETIAP kiriman aktif dikirim ke queue tiap 30 menit,
  // jadi satu kiriman menelan 48 x 15 = 720 credit/hari — dan hampir semuanya
  // sia-sia karena kurir tidak memperbarui status secepat itu.
  //
  // Disaring di sini, bukan di consumer: pesan yang tidak pernah dibuat tidak
  // memakai kuota queue, dan tidak ada jalan pintas yang bisa melewatkannya.
  const due = activeShipments.filter(s => isResiPollDue({
    status:      s.status,
    lastChecked: s.lastChecked,
    createdAt:   s.createdAt,
  }));

  // Batch ke queue untuk diproses
  const messages = due
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

  // Queues menolak sendBatch lebih dari 100 pesan sekali kirim. Sebelum ada
  // penyaring di atas, toko dengan ratusan kiriman aktif melewatinya tiap 30
  // menit dan seluruh polling gagal — diam-diam, karena cron tidak punya
  // pembaca.
  for (let i = 0; i < messages.length; i += 100) {
    await env.RESI_POLL_QUEUE.sendBatch(messages.slice(i, i + 100));
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
      // Cache dibaca DULU. Sebelumnya ia hanya ditulis dan tidak pernah dibaca
      // di sini, sehingga janji "cache 30 menit untuk kurangi biaya Binderbyte"
      // tidak pernah berlaku di jalur yang paling boros. Gunanya nyata: kalau
      // pembeli baru saja melacak resinya sendiri lewat /api/shipping/resi,
      // hasilnya masih segar dan cron tidak perlu membayar lagi.
      const cached = await env.CACHE_KV.get(KV_KEYS.resi(trackingNo));

      let status:  string | undefined;
      let history: any[] = [];

      if (cached) {
        const c = JSON.parse(cached) as { status?: string; history?: any[] };
        status  = c.status;
        history = c.history ?? [];
      } else {
        // Lewat services/tracking.ts, bukan memanggil Binderbyte langsung.
        // Sebelumnya poller punya salinan kodenya sendiri yang sudah menyimpang
        // dari milik rute — dan di sanalah RajaOngkir yang gratis dipilih lebih
        // dulu untuk kurir yang didukungnya.
        const hasil = await trackWaybill(env, trackingNo, courier);

        if (!hasil) {
          // lastChecked tetap disetel supaya resi yang belum terdaftar di
          // sistem kurir tidak dipanggil ulang tiap kali cron jalan.
          await db.update(shipments)
            .set({ lastChecked: new Date(), updatedAt: new Date() })
            .where(eq(shipments.id, shipmentId));
          msg.ack();
          continue;
        }

        status  = hasil.status;
        history = hasil.history.map(h => ({ date: h.date, desc: h.description, location: h.location }));

        await env.CACHE_KV.put(
          KV_KEYS.resi(trackingNo),
          JSON.stringify({ trackingNo, courier, status, history }),
          { expirationTtl: KV_TTL.resi },
        );
      }

      // Aturan penilaian dipusatkan di services/tracking.ts supaya poller dan
      // rute tidak pernah menilai "sudah sampai" dengan cara berbeda.
      const sudahSampai = isDelivered(status);

      const lastStatus = history[0]
        ? { description: history[0].desc, date: history[0].date, location: history[0].location }
        : null;

      // Update shipment (status cuma diubah kalau delivered — selain itu biarkan apa adanya)
      await db.update(shipments)
        .set({
          lastStatus,
          lastChecked: new Date(),
          ...(sudahSampai ? { status: "delivered" as const } : {}),
          updatedAt: new Date(),
        })
        .where(eq(shipments.id, shipmentId));

      // Kalau delivered, update order status
      if (sudahSampai) {
        await db.update(orders)
          .set({ status: "delivered", updatedAt: new Date() })
          .where(eq(orders.id, orderId));

        // Jaring pengaman: kalau order sampai "delivered" tanpa pernah lewat
        // input resi manual, stoknya belum pernah dipotong. Idempoten, jadi
        // tidak dobel kalau sudah dipotong saat shipped.
        await deductOrderStock(db, orderId);

        await env.NOTIFICATION_QUEUE.send({ type: "order_delivered", orderId, trackingNo });
      }

      msg.ack();
    } catch (err) {
      console.error(`Error polling resi ${trackingNo}:`, err);
      msg.retry();
    }
  }
}
