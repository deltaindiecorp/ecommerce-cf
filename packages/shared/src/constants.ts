// ─── KV Key Prefixes ──────────────────────────────────────────────────────────
export const KV_KEYS = {
  cart:          (id: string) => `cart:${id}`,
  guestSession:  (id: string) => `guest_session:${id}`,
  resi:          (no: string) => `resi:${no}`,
  ongkir:        (from: number, to: number, weight: number) => `ongkir:${from}:${to}:${weight}`,
  productCache:  (slug: string) => `product:${slug}`,
  otpEmail:      (email: string) => `otp:${email}`,
  rajaongkirCities: "rajaongkir:cities:all",
} as const;

// ─── KV TTLs (seconds) ────────────────────────────────────────────────────────
export const KV_TTL = {
  cart:         60 * 60 * 24,      // 24 jam
  guestSession: 60 * 60 * 2,       // 2 jam
  resi:         60 * 30,           // 30 menit
  ongkir:       60 * 10,           // 10 menit
  product:      60 * 5,            // 5 menit
  otp:          60 * 10,           // 10 menit
  cities:       60 * 60 * 24,      // 24 jam — daftar kota RajaOngkir jarang berubah
} as const;

// ─── Order Status Labels ──────────────────────────────────────────────────────
export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_payment: "Menunggu Pembayaran",
  paid:            "Pembayaran Diterima",
  processing:      "Sedang Diproses",
  packed:          "Dikemas",
  shipped:         "Dalam Pengiriman",
  delivered:       "Telah Diterima",
  completed:       "Selesai",
  cancelled:       "Dibatalkan",
  refunded:        "Dikembalikan",
};

// ─── Order Fulfillment ────────────────────────────────────────────────────────
// Status yang berarti barang sudah keluar fisik dari gudang. Begitu order masuk
// salah satu status ini, reservasi stok dikonversi jadi pengurangan stok riil
// (lihat deductOrderStock di apps/api/src/services/inventory.ts). Sengaja dipisah
// dari ORDER_STATUS_LABEL supaya logika stok tidak ikut berubah kalau teks
// tampilannya diubah.
export const FULFILLED_STATUSES = ["shipped", "delivered", "completed"] as const;

export function isFulfilledStatus(status: string): boolean {
  return (FULFILLED_STATUSES as readonly string[]).includes(status);
}

// ─── Transisi Status Order ────────────────────────────────────────────────────
// Transisi yang boleh dilakukan admin lewat PATCH /api/admin/orders/:id/status.
// Sebelumnya endpoint itu menerima string apa pun tanpa cek, jadi order bisa
// melompat dari "pending_payment" langsung ke "completed", atau order yang sudah
// "refunded" dikembalikan ke "paid".
//
// "refunded" SENGAJA tidak pernah jadi tujuan di sini. Refund harus lewat
// POST /api/payment/:orderId/refund yang benar-benar memanggil gateway —
// menyetelnya lewat PATCH akan menandai order sebagai dikembalikan tanpa uang
// yang benar-benar kembali ke pembeli.
export const ORDER_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  pending_payment: ["paid", "cancelled"],
  paid:            ["processing", "packed", "shipped", "cancelled"],
  processing:      ["packed", "shipped", "cancelled"],
  packed:          ["shipped", "cancelled"],
  shipped:         ["delivered"],
  delivered:       ["completed"],
  completed:       [],
  cancelled:       [],
  refunded:        [],
};

export function allowedNextStatuses(current: string): readonly string[] {
  return ORDER_STATUS_TRANSITIONS[current] ?? [];
}

export function canTransitionOrderStatus(from: string, to: string): boolean {
  return allowedNextStatuses(from).includes(to);
}

// ─── Courier List ─────────────────────────────────────────────────────────────
export const COURIERS = [
  { code: "jne",     name: "JNE" },
  { code: "jnt",     name: "J&T Express" },
  { code: "sicepat", name: "SiCepat" },
  { code: "pos",     name: "Pos Indonesia" },
  { code: "tiki",    name: "TIKI" },
  { code: "ninja",   name: "Ninja Xpress" },
  { code: "anteraja",name: "AnterAja" },
] as const;

// ─── Payment Expiry (ms) ──────────────────────────────────────────────────────
export const PAYMENT_EXPIRY_MS = {
  va:   24 * 60 * 60 * 1000,   // 24 jam
  qris: 15 * 60 * 1000,        // 15 menit
  cod:  0,
} as const;

// ─── Warehouse Routing Strategy ───────────────────────────────────────────────
export const WAREHOUSE_ROUTING = {
  strategy: "nearest_with_stock", // nearest_with_stock | priority | round_robin
  stockReserveTtlMs: 15 * 60 * 1000, // 15 menit
} as const;
