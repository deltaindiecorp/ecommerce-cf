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
