// ─── Alur pembayaran ──────────────────────────────────────────────────────────
// POST /api/payment/create sudah lengkap di sisi server sejak awal — tapi TIDAK
// PERNAH dipanggil siapa pun. Checkout hanya menyebutnya sebagai `nextStep`
// dalam responsnya, sebuah petunjuk teks yang tidak ada yang menindaklanjuti.
//
// Akibatnya pembeli bisa membuat pesanan tapi tidak pernah diarahkan ke Midtrans
// maupun Xendit: halaman /payment cuma memantau status yang tidak akan pernah
// berubah dari "pending", dan `snapRedirectUrl` yang dibuat API dibuang.
//
// Keputusan "apa yang harus terjadi berikutnya" dipisah ke sini sebagai fungsi
// murni supaya bisa diuji tanpa Remix, jaringan, maupun gateway sungguhan —
// salah bercabang di sini berarti pembeli tidak bisa membayar, atau lebih buruk,
// membayar dua kali.

export type PaymentSnapshot = {
  status?:     string | null;
  gateway?:    string | null;
  paymentUrl?: string | null;
  expiredAt?:  number | string | null;
} | null;

export type PaymentStep =
  /** Bawa pembeli ke halaman bayar gateway. */
  | { kind: "redirect"; url: string }
  /** Bayar di tempat — tidak ada gateway yang perlu dibuka. */
  | { kind: "cod" }
  /** Menunggu konfirmasi. `url` ada kalau pembeli masih bisa melanjutkan. */
  | { kind: "wait"; url: string | null }
  | { kind: "paid" }
  /** Kedaluwarsa, gagal, atau dibatalkan — tidak bisa dilanjutkan. */
  | { kind: "closed"; status: string };

const SELESAI = new Set(["paid"]);
const TERTUTUP = new Set(["expired", "failed", "refunded", "cancelled"]);

// `baruDibuat` membedakan dua keadaan yang tampak sama dari data: pembeli yang
// baru saja checkout harus langsung dibawa ke gateway, sedangkan pembeli yang
// kembali ke halaman ini tidak boleh dilempar keluar begitu saja — ia mungkin
// sudah membayar di tab lain dan sedang menunggu konfirmasi.
export function nextPaymentStep(snapshot: PaymentSnapshot, baruDibuat = false): PaymentStep {
  const status = String(snapshot?.status ?? "").toLowerCase();

  if (SELESAI.has(status)) return { kind: "paid" };
  if (TERTUTUP.has(status)) return { kind: "closed", status };

  // COD tidak punya halaman bayar; tagihannya diselesaikan saat barang datang.
  if (String(snapshot?.gateway ?? "").toLowerCase() === "cod") return { kind: "cod" };

  const url = typeof snapshot?.paymentUrl === "string" && snapshot.paymentUrl.trim()
    ? snapshot.paymentUrl
    : null;

  if (baruDibuat && url) return { kind: "redirect", url };
  return { kind: "wait", url };
}

// Alamat bayar berasal dari respons gateway dan dibuka di browser pembeli, jadi
// diperlakukan sebagai masukan yang tidak dipercaya: hanya https, dan hanya ke
// domain gateway yang memang kita pakai.
//
// Tanpa saringan ini, nilai yang salah — entah karena gateway berubah, salah
// konfigurasi, atau respons yang dimanipulasi — bisa mengarahkan pembeli ke
// situs mana pun tepat saat ia bersiap membayar.
const DOMAIN_GATEWAY = [
  "midtrans.com",
  "veritrans.co.id",
  "xendit.co",
  "invoice.xendit.co",
];

export function isSafePaymentUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;

  return DOMAIN_GATEWAY.some(d => u.hostname === d || u.hostname.endsWith(`.${d}`));
}
