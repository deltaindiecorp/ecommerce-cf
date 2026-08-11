// ─── Umur Token per Peran ─────────────────────────────────────────────────────
// Sesi panel admin sengaja jauh lebih pendek daripada sesi pembeli: satu token
// admin yang bocor bisa me-refund, menghapus produk, dan mengubah stok.
// Sebelumnya semua peran dapat 7 hari, dan cookie admin di-set 1 hari sehingga
// token tetap sah 6 hari setelah browser berhenti mengirimkannya.
export const TOKEN_TTL_SEC = {
  admin:    12 * 60 * 60,
  staff:    12 * 60 * 60,
  customer: 7 * 24 * 60 * 60,
  guest:    2 * 60 * 60,
} as const;

export function tokenTtlForRole(role: string): number {
  return TOKEN_TTL_SEC[role as keyof typeof TOKEN_TTL_SEC] ?? TOKEN_TTL_SEC.customer;
}

// ─── KV Key Prefixes ──────────────────────────────────────────────────────────
export const KV_KEYS = {
  cart:          (id: string) => `cart:${id}`,
  guestSession:  (id: string) => `guest_session:${id}`,
  resi:          (no: string) => `resi:${no}`,
  ongkir:        (from: number, to: number, weight: number) => `ongkir:${from}:${to}:${weight}`,
  productCache:  (slug: string) => `product:${slug}`,
  otpEmail:      (email: string) => `otp:${email}`,
  rajaongkirCities: "rajaongkir:cities:all",
  // Daftar cabut token. Kunci per jti, TTL disamakan dengan sisa umur token
  // supaya entrinya hilang sendiri saat tokennya memang sudah kedaluwarsa.
  revokedToken: (jti: string) => `revoked:${jti}`,
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

// ─── Zona Waktu Toko ──────────────────────────────────────────────────────────
// Satu-satunya definisi "hari" untuk seluruh laporan. Sebelumnya ada dua
// implementasi terpisah — SQL memakai date(..., '+7 hours') sementara JS punya
// wibDateKey() sendiri. Keduanya kebetulan sepakat, tapi mengubah salah satunya
// akan membuat "hari ini" di kartu statistik berbeda dari "hari ini" di grafik,
// tanpa satu pun test yang gagal.
export const WIB_OFFSET_HOURS = 7;

// Modifier untuk fungsi date()/datetime() SQLite, dibangun dari konstanta yang
// sama supaya SQL dan JS tidak bisa lagi menyimpang.
export const SQLITE_WIB_MODIFIER = `+${WIB_OFFSET_HOURS} hours`;

// Tanggal kalender WIB dalam format YYYY-MM-DD. Digeser dulu lalu diformat
// sebagai UTC — trik umum untuk mendapat tanggal lokal tanpa library timezone.
export function wibDateKey(offsetDays = 0, now: number = Date.now()): string {
  const ms = now + WIB_OFFSET_HOURS * 3600_000 - offsetDays * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

// ─── Order Status Labels ──────────────────────────────────────────────────────
// Satu sumber untuk seluruh panel. Sebelumnya terduplikasi di empat berkas
// route dengan teks yang sudah mulai berbeda ("Diproses" vs "Sedang Diproses"),
// sementara konstanta ini justru tidak dipakai siapa pun.
//
// Dipilih bentuk ringkas karena mayoritas pemakaiannya adalah badge di tabel.
export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_payment: "Menunggu Bayar",
  paid:            "Lunas",
  processing:      "Diproses",
  packed:          "Dikemas",
  shipped:         "Dikirim",
  delivered:       "Diterima",
  completed:       "Selesai",
  cancelled:       "Batal",
  refunded:        "Refund",
};

export const ORDER_STATUS_COLOR: Record<string, string> = {
  pending_payment: "bg-yellow-100 text-yellow-700",
  paid:            "bg-green-100 text-green-700",
  processing:      "bg-blue-100 text-blue-700",
  packed:          "bg-purple-100 text-purple-700",
  shipped:         "bg-indigo-100 text-indigo-700",
  delivered:       "bg-teal-100 text-teal-700",
  completed:       "bg-gray-100 text-gray-700",
  cancelled:       "bg-red-100 text-red-700",
  refunded:        "bg-orange-100 text-orange-700",
};

// Urutan untuk chip filter di daftar pesanan. "" = semua.
// `refunded` sempat hilang dari daftar ini, sehingga pesanan yang sudah
// di-refund hanya bisa ditemukan lewat "Semua".
export const ORDER_STATUS_FILTERS = [
  "", "pending_payment", "paid", "processing", "packed",
  "shipped", "delivered", "completed", "cancelled", "refunded",
] as const;

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
