import { describe, it, expect } from "vitest";

import { nextPaymentStep, isSafePaymentUrl } from "./payment";

// Percabangan di sini menentukan apakah pembeli bisa membayar sama sekali.
// Sebelum ini ada, POST /api/payment/create tidak pernah dipanggil siapa pun:
// pesanan dibuat, lalu halaman /payment memantau status yang tidak akan pernah
// berubah dari "pending" — pembeli menatap "⏳ Menunggu Pembayaran" selamanya.
describe("langkah pembayaran berikutnya", () => {
  const gateway = { status: "pending", gateway: "midtrans", paymentUrl: "https://app.midtrans.com/snap/x" };

  it("pembeli yang baru checkout langsung dibawa ke halaman bayar", () => {
    expect(nextPaymentStep(gateway, true)).toEqual({
      kind: "redirect",
      url:  "https://app.midtrans.com/snap/x",
    });
  });

  // Pembeli yang kembali mungkin sudah membayar di tab lain dan sedang menunggu
  // konfirmasi webhook. Melemparnya ke gateway lagi berisiko tagihan kedua.
  it("pembeli yang kembali TIDAK dilempar ulang ke gateway", () => {
    expect(nextPaymentStep(gateway, false)).toEqual({
      kind: "wait",
      url:  "https://app.midtrans.com/snap/x",
    });
  });

  it("lunas berhenti di layar sukses", () => {
    expect(nextPaymentStep({ status: "paid", gateway: "midtrans" }, true)).toEqual({ kind: "paid" });
  });

  // COD tidak punya halaman bayar. Versi lama endpoint-nya menjatuhkan "cod" ke
  // cabang else — yaitu Xendit — sehingga pembeli yang memilih bayar di tempat
  // malah ditagih lewat gateway.
  it("COD tidak pernah diarahkan ke gateway", () => {
    expect(nextPaymentStep({ status: "pending", gateway: "cod", paymentUrl: null }, true))
      .toEqual({ kind: "cod" });
  });

  it.each(["expired", "failed", "refunded", "cancelled"])(
    "status %s tidak bisa dilanjutkan", (status) => {
      expect(nextPaymentStep({ status, gateway: "xendit" }, false)).toEqual({ kind: "closed", status });
    });

  // Gateway sempat menolak, atau URL-nya belum sempat tersimpan: pembeli tetap
  // di layar tunggu, bukan dialihkan ke alamat kosong.
  it.each([
    ["url null", { status: "pending", gateway: "midtrans", paymentUrl: null }],
    ["url spasi", { status: "pending", gateway: "midtrans", paymentUrl: "   " }],
    ["tanpa pembayaran", null],
  ])("tanpa alamat bayar tetap menunggu: %s", (_l, snap) => {
    expect(nextPaymentStep(snap as any, true)).toEqual({ kind: "wait", url: null });
  });

  it("Xendit dipakai lewat invoiceUrl yang sudah dinormalkan pemanggil", () => {
    expect(nextPaymentStep({ status: "pending", gateway: "xendit", paymentUrl: "https://checkout.xendit.co/v2/abc" }, true))
      .toEqual({ kind: "redirect", url: "https://checkout.xendit.co/v2/abc" });
  });
});

// Alamat ini dibuka di browser pembeli tepat saat ia bersiap membayar — momen
// paling berbahaya untuk diarahkan ke tempat yang salah. Jadi ia diperlakukan
// sebagai masukan tak terpercaya, bukan karena gateway-nya jahat, tapi karena
// salah konfigurasi atau respons yang dimanipulasi tidak boleh berujung phishing.
describe("pemeriksaan alamat bayar", () => {
  it.each([
    "https://app.midtrans.com/snap/v3/redirection/abc",
    "https://app.sandbox.midtrans.com/snap/v3/x",
    "https://checkout.xendit.co/web/abc",
    "https://invoice.xendit.co/abc",
  ])("menerima domain gateway: %s", (u) => expect(isSafePaymentUrl(u)).toBe(true));

  it.each([
    ["http, bukan https", "http://app.midtrans.com/snap/x"],
    ["domain lain", "https://penyerang.example/snap"],
    // Yang paling mudah lolos kalau pengecekannya sekadar "mengandung":
    ["akhiran menipu", "https://app.midtrans.com.penyerang.example/x"],
    ["subdomain palsu", "https://midtrans.com.evil.co/x"],
    ["bukan URL", "bukan-url"],
    ["kosong", ""],
    ["null", null],
  ])("menolak %s", (_l, u) => expect(isSafePaymentUrl(u as any)).toBe(false));
});
