import { Hono } from "hono";
import type { Env } from "../types/env";
import { optionalAuth } from "../middleware/auth";
import { checkoutSchema, KV_KEYS, KV_TTL } from "@repo/shared";
import type { Cart } from "@repo/shared";
import { createD1Client } from "@repo/db";
import { orders, orderItems, inventory, inventoryMovements, warehouses, products, productVariants } from "@repo/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { generateOrderNo, createId } from "@repo/db";
import { reserveStockLock, releaseStockLock, inventoryRowFilter } from "../services/inventory";
import { resolveShippingRate } from "../services/shipping";
import { checkVoucher, incrementVoucherUsage } from "../services/voucher";

export const checkoutRouter = new Hono<{ Bindings: Env }>();

// ─── POST /api/checkout ───────────────────────────────────────────────────────
checkoutRouter.post("/", optionalAuth, async (c) => {
  const body   = await c.req.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.flatten() }, 400);
  }

  const data   = parsed.data;
  const cartId = c.req.header("X-Cart-Id");
  if (!cartId) return c.json({ success: false, error: "Cart ID diperlukan" }, 400);

  // Ambil cart dari KV
  const rawCart = await c.env.CART_KV.get(KV_KEYS.cart(cartId));
  if (!rawCart) return c.json({ success: false, error: "Cart tidak ditemukan atau sudah expired" }, 404);

  const cart: Cart = JSON.parse(rawCart);
  if (cart.items.length === 0) return c.json({ success: false, error: "Cart kosong" }, 400);

  // Validasi guest checkout
  const userId = c.get("userId");
  if (!userId) {
    if (!data.guestName || !data.guestEmail || !data.guestPhone) {
      return c.json({ success: false, error: "Nama, email, dan nomor HP wajib diisi untuk guest checkout" }, 400);
    }
  }

  const db = createD1Client(c.env.DB);

  // ─── Warehouse Routing ─────────────────────────────────────────────────────
  // Cari warehouse terdekat yang punya stok untuk semua item
  const allWarehouses = await db.select().from(warehouses)
    .where(eq(warehouses.isActive, true))
    .orderBy(warehouses.priority);

  // Metadata produk diambil sekali di depan: dipakai untuk memutuskan apakah
  // item perlu dicarikan stok, sekaligus untuk snapshot harga modal nanti.
  const cartProductIds = [...new Set(cart.items.map(i => i.productId))];
  const cartVariantIds = [...new Set(
    cart.items.map(i => i.variantId).filter((v): v is string => Boolean(v))
  )];

  const [productMetaRows, costVariantRows] = await Promise.all([
    db.select({
      id: products.id, costPrice: products.costPrice, trackInventory: products.trackInventory,
    }).from(products).where(inArray(products.id, cartProductIds)),
    cartVariantIds.length
      ? db.select({ id: productVariants.id, costPrice: productVariants.costPrice })
          .from(productVariants).where(inArray(productVariants.id, cartVariantIds))
      : Promise.resolve([] as Array<{ id: string; costPrice: number | null }>),
  ]);

  const productMeta = new Map(productMetaRows.map(r => [r.id, r]));
  const variantCost = new Map(costVariantRows.map(r => [r.id, r.costPrice]));

  // Produk tanpa pelacakan stok (jasa, digital, pre-order) tidak punya baris
  // inventory sama sekali. Tanpa pengecualian ini, cek `available` selalu 0 dan
  // checkout menolaknya — produk semacam itu tidak akan pernah bisa dijual.
  const isTracked = (productId: string) => productMeta.get(productId)?.trackInventory !== false;

  const assignedItems: Array<typeof cart.items[0] & { warehouseId: string }> = [];
  // Lock yang berhasil didapat dari StockLockDurableObject — dirilis setelah
  // reservasi permanen ditulis ke D1, atau di-rollback kalau checkout gagal.
  const acquiredLocks: Array<{ warehouseId: string; productId: string; variantId?: string; qty: number }> = [];

  async function releaseAcquiredLocks() {
    await Promise.all(
      acquiredLocks.map(l => releaseStockLock(c.env, l.warehouseId, l.productId, l.variantId, l.qty))
    );
  }

  for (const item of cart.items) {
    let assigned = false;

    // Tidak butuh stok — cukup ditempelkan ke gudang aktif pertama supaya
    // order_items tetap punya warehouseId yang sah untuk keperluan pengiriman.
    if (!isTracked(item.productId)) {
      const fallback = allWarehouses[0];
      if (!fallback) {
        await releaseAcquiredLocks();
        return c.json({ success: false, error: "Tidak ada gudang aktif" }, 400);
      }
      assignedItems.push({ ...item, warehouseId: fallback.id });
      continue;
    }

    for (const wh of allWarehouses) {
      const inv = await db.select().from(inventory).where(
        and(
          eq(inventory.warehouseId, wh.id),
          eq(inventory.productId, item.productId),
          ...(item.variantId ? [eq(inventory.variantId, item.variantId)] : [])
        )
      ).get();

      const available = (inv?.qtyOnHand ?? 0) - (inv?.qtyReserved ?? 0);
      if (available < item.qty) continue;

      // Reservasi atomik lewat Durable Object — mencegah dua checkout concurrent
      // sama-sama lolos cek `available` di atas lalu berebut stok yang sama.
      const lock = await reserveStockLock(c.env, wh.id, item.productId, item.variantId, item.qty, available);
      if (!lock.success) continue; // sudah direbut request lain barusan, coba gudang berikutnya

      assignedItems.push({ ...item, warehouseId: wh.id });
      acquiredLocks.push({ warehouseId: wh.id, productId: item.productId, variantId: item.variantId, qty: item.qty });
      assigned = true;
      break;
    }

    if (!assigned) {
      await releaseAcquiredLocks();
      return c.json({
        success: false,
        error: `Stok tidak cukup untuk produk: ${item.productName}`,
      }, 400);
    }
  }

  // ─── Ongkir (dihitung server, bukan dari form) ──────────────────────────────
  // Gudang asal ditentukan hasil routing di atas. Kalau item tersebar di
  // beberapa gudang, dipakai gudang item pertama — sama seperti perilaku lama
  // yang hanya menyimpan satu ongkir per order. Memecah ongkir per gudang
  // adalah perubahan model tersendiri, bukan bagian dari perbaikan ini.
  const originWarehouseId = assignedItems[0]?.warehouseId;
  const originWarehouse   = allWarehouses.find(w => w.id === originWarehouseId);

  if (!originWarehouse) {
    await releaseAcquiredLocks();
    return c.json({ success: false, error: "Gudang pengirim tidak bisa ditentukan" }, 400);
  }

  // Gudang yang belum punya ID tujuan tidak bisa dipakai menghitung ongkir.
  // Ini muncul setelah migrasi 0010 mengosongkan ID kota versi lama — dan
  // ditolak di sini, bukan dibiarkan lewat, karena API RajaOngkir menerima ID
  // basi tanpa mengeluh dan mengembalikan tarif kelurahan lain. Lebih baik
  // checkout berhenti dengan pesan yang jelas daripada menagih ongkir yang
  // salah 12x lipat tanpa ada yang menyadarinya.
  if (!originWarehouse.rajaongkirCityId) {
    await releaseAcquiredLocks();
    return c.json({
      success: false,
      error: `Gudang "${originWarehouse.name}" belum punya lokasi pengiriman. ` +
             "Admin perlu memilih ulang kelurahan gudang di panel (Gudang → Edit) " +
             "sebelum pesanan dari gudang ini bisa diproses.",
    }, 400);
  }

  const totalWeight = cart.items.reduce((sum, i) => sum + i.weight * i.qty, 0);

  const rate = await resolveShippingRate(c.env, {
    origin:      originWarehouse.rajaongkirCityId,
    destination: data.shippingAddress.rajaongkirCityId,
    weight:      Math.max(1, totalWeight),
    courier:     data.courier,
    service:     data.service,
  }).catch(() => null);

  // Ditolak, bukan jatuh ke nilai dari klien. Ongkir yang tidak bisa
  // diverifikasi berarti kita tidak tahu berapa yang harus ditagih — menebak
  // ke arah mana pun merugikan salah satu pihak.
  if (!rate) {
    await releaseAcquiredLocks();
    return c.json({
      success: false,
      error: `Ongkir untuk ${data.courier.toUpperCase()} ${data.service} ke tujuan ini tidak bisa diverifikasi. Silakan cek ongkir ulang dan pilih layanan yang tersedia.`,
    }, 400);
  }

  const shippingCost = rate.cost;

  // ─── Voucher ────────────────────────────────────────────────────────────────
  let discount = 0;
  let appliedVoucherId: string | null = null;
  if (data.voucherCode) {
    const voucherCheck = await checkVoucher(db, data.voucherCode, cart.subtotal);
    if (!voucherCheck.valid) {
      await releaseAcquiredLocks();
      return c.json({ success: false, error: voucherCheck.error }, 400);
    }
    discount        = voucherCheck.discount;
    appliedVoucherId = voucherCheck.voucher.id;
  }

  // ─── Create Order ──────────────────────────────────────────────────────────
  const orderId       = createId();
  const orderNo       = generateOrderNo();
  const total          = cart.subtotal + shippingCost - discount;

  await db.insert(orders).values({
    id:              orderId,
    orderNo,
    userId:          userId ?? null,
    guestEmail:      data.guestEmail ?? null,
    guestPhone:      data.guestPhone ?? null,
    guestName:       data.guestName ?? null,
    status:          "pending_payment",
    shippingAddress: data.shippingAddress,
    subtotal:        cart.subtotal,
    shippingCost,
    discount,
    total,
    paymentMethod:   data.paymentMethod,
    voucherCode:     data.voucherCode ?? null,
    customerNote:    data.note ?? null,
  });

  // ─── Snapshot Harga Modal ──────────────────────────────────────────────────
  // Diambil dari DB saat checkout (lihat productMeta di atas), bukan dibawa
  // lewat cart: cart tersimpan di KV dan ikut dikirim ke browser pembeli. Nilai
  // yang benar juga nilai saat order dibuat — modal berubah tiap restock.
  //
  // Varian boleh override modal produk. Pakai ?? (bukan ||) supaya modal 0 yang
  // memang disetel tidak jatuh ke fallback. NULL = produk belum diisi modalnya.
  function costSnapshotFor(productId: string, variantId?: string): number | null {
    const fromVariant = variantId ? variantCost.get(variantId) : null;
    return fromVariant ?? productMeta.get(productId)?.costPrice ?? null;
  }

  // ─── Insert Order Items + Reserve Stock ────────────────────────────────────
  for (const item of assignedItems) {
    await db.insert(orderItems).values({
      id:             createId(),
      orderId,
      warehouseId:    item.warehouseId,
      productId:      item.productId,
      variantId:      item.variantId ?? null,
      productName:    item.productName,
      variantName:    item.variantName ?? null,
      sku:            item.sku,
      imageUrl:       item.imageUrl ?? null,
      priceSnapshot:  item.price,
      costSnapshot:   costSnapshotFor(item.productId, item.variantId),
      weightSnapshot: item.weight,
      qty:            item.qty,
      subtotal:       item.subtotal,
    });

    // Produk tak terlacak tidak punya baris inventory — tidak ada yang perlu
    // direservasi, dan mencatat pergerakan hanya akan mengotori kartu stok.
    if (!isTracked(item.productId)) continue;

    // Reserve stok — filter baris pakai helper yang sama dengan release/deduct
    await db.update(inventory)
      .set({ qtyReserved: sql`qty_reserved + ${item.qty}`, updatedAt: new Date() })
      .where(inventoryRowFilter(item.warehouseId, item.productId, item.variantId));

    // Log movement
    await db.insert(inventoryMovements).values({
      id:          createId(),
      warehouseId: item.warehouseId,
      productId:   item.productId,
      variantId:   item.variantId ?? null,
      type:        "reserve",
      qty:         item.qty,
      refType:     "order",
      refId:       orderId,
      createdBy:   userId ?? null,
      note:        `Reserve untuk order ${orderNo}`,
    });
  }

  // Reservasi sudah persisten di D1 (qty_reserved) — lepas lock sementara di DO
  // supaya tidak dihitung dobel oleh cek `available` pada checkout berikutnya.
  await releaseAcquiredLocks();

  if (appliedVoucherId) {
    await incrementVoucherUsage(db, appliedVoucherId);
  }

  // Hapus cart setelah checkout berhasil
  await c.env.CART_KV.delete(KV_KEYS.cart(cartId));

  // Queue notif ke customer
  await c.env.NOTIFICATION_QUEUE.send({
    type:    "order_created",
    orderId,
    orderNo,
    email:   userId ? undefined : data.guestEmail,
    userId,
  });

  return c.json({
    success: true,
    data: {
      orderId,
      orderNo,
      total,
      paymentMethod: data.paymentMethod,
      nextStep:      `/api/payment/create`,
    },
  }, 201);
});

// ─── GET /api/checkout/ongkir ─────────────────────────────────────────────────
// Proxy ke shipping route, disediakan di sini untuk convenience checkout flow
checkoutRouter.get("/ongkir", async (c) => {
  return c.redirect("/api/shipping/ongkir?" + new URL(c.req.url).searchParams.toString());
});

// ─── POST /api/checkout/voucher/validate ──────────────────────────────────────
// Preview diskon voucher sebelum submit order (dipanggil dari halaman checkout)
checkoutRouter.post("/voucher/validate", async (c) => {
  const { code, subtotal } = await c.req.json<{ code: string; subtotal: number }>();
  if (!code || typeof subtotal !== "number") {
    return c.json({ success: false, error: "code dan subtotal wajib diisi" }, 400);
  }

  const db     = createD1Client(c.env.DB);
  const result = await checkVoucher(db, code, subtotal);

  if (!result.valid) return c.json({ success: false, error: result.error }, 400);
  return c.json({ success: true, data: { discount: result.discount, code: result.voucher.code } });
});
