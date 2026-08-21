import { describe, it, expect } from "vitest";

import { midtransSignature, xenditWebhookVerdict } from "./payment";

// Vektor di bawah dihitung DI LUAR kode ini (python hashlib) memakai rumus resmi
// Midtrans, lalu ditempel apa adanya. Kalau ekspektasinya ikut dihitung oleh
// fungsi yang sedang diuji, test-nya cuma membuktikan fungsi itu konsisten
// dengan dirinya sendiri — bukan dengan Midtrans.
//
// SHA512("pay_abc123" + "200" + "90000.00" + "SB-Mid-server-CONTOH")
const ORDER  = "pay_abc123";
const STATUS = "200";
const GROSS  = "90000.00";
const KEY    = "SB-Mid-server-CONTOH";

const BENAR =
  "056bbd23347862782f9c0b1c99bd19fb1fd8a1e2d268a8e9277093ff51272d7c" +
  "a01b7a83983a4c39ad08cd3027b720e155b74932cf9667c3b7d340fde0cdfabb";

// Rumus yang dipakai sebelumnya: transaction_id di posisi status_code.
const RUMUS_LAMA_SALAH =
  "baed8cf5e99953c7ee6d5359ebb845ea9f2a29c4a26deca5a42c809b26b925b4" +
  "33b077d3340456429bb727d55f2ec7030523d8cd6ef617886fd51da462d9e71e";

describe("signature webhook Midtrans", () => {
  it("cocok dengan rumus resmi", async () => {
    expect(await midtransSignature(ORDER, STATUS, GROSS, KEY)).toBe(BENAR);
  });

  // Inti perbaikannya. Sebelumnya kode memakai transaction_id, sehingga SETIAP
  // webhook asli ditolak "Invalid signature" — pembeli membayar, uang masuk,
  // pesanan menggantung selamanya, stok tidak pernah dipotong. Gejalanya sama
  // sekali tidak menunjuk ke rumus signature.
  it("BUKAN rumus lama yang memakai transaction_id", async () => {
    expect(await midtransSignature(ORDER, STATUS, GROSS, KEY)).not.toBe(RUMUS_LAMA_SALAH);
  });

  it("berubah kalau salah satu bagiannya berbeda", async () => {
    const asli = await midtransSignature(ORDER, STATUS, GROSS, KEY);
    expect(await midtransSignature("pay_lain", STATUS, GROSS, KEY)).not.toBe(asli);
    expect(await midtransSignature(ORDER, "201", GROSS, KEY)).not.toBe(asli);
    expect(await midtransSignature(ORDER, STATUS, "90000", KEY)).not.toBe(asli);
    expect(await midtransSignature(ORDER, STATUS, GROSS, "kunci-lain")).not.toBe(asli);
  });

  // Nominal ikut ditandatangani, jadi mengubahnya membatalkan tanda tangan —
  // inilah yang mencegah webhook palsu menandai pesanan lunas dengan jumlah
  // yang tidak pernah dibayar.
  it("nominal yang diubah menghasilkan signature berbeda", async () => {
    const asli = await midtransSignature(ORDER, STATUS, GROSS, KEY);
    expect(await midtransSignature(ORDER, STATUS, "1.00", KEY)).not.toBe(asli);
  });

  it("hex 128 karakter huruf kecil", async () => {
    expect(await midtransSignature(ORDER, STATUS, GROSS, KEY)).toMatch(/^[0-9a-f]{128}$/);
  });
});

// ─── Webhook Xendit ───────────────────────────────────────────────────────────
// Xendit TIDAK menandatangani isi webhook-nya — hanya token statis di header.
// Berbeda dari Midtrans, yang signature-nya mencakup gross_amount, di sini tidak
// ada apa pun yang mengikat nominal maupun invoice mana yang dimaksud. Jadi
// pemeriksaannya harus dilakukan terhadap catatan kita sendiri, dan fungsi
// inilah yang memutuskan sebuah pesanan ditandai lunas.
describe("keputusan webhook Xendit", () => {
  const dasar = {
    status:            "PAID",
    invoiceId:         "inv-123",
    expectedInvoiceId: "inv-123",
    paidAmount:        90000,
    expectedAmount:    90000,
  };

  it("nominal pas dan invoice cocok → lunas", () => {
    expect(xenditWebhookVerdict(dasar)).toEqual({ kind: "lunas" });
  });

  it("SETTLED diperlakukan sama dengan PAID", () => {
    expect(xenditWebhookVerdict({ ...dasar, status: "SETTLED" })).toEqual({ kind: "lunas" });
  });

  // Sebelumnya paid_amount tidak pernah dibandingkan sama sekali: bayar seribu
  // rupiah untuk tagihan sembilan puluh ribu tetap menandai pesanan lunas.
  it("kurang bayar DITOLAK, bukan ditandai lunas", () => {
    const v = xenditWebhookVerdict({ ...dasar, paidAmount: 1000 });
    expect(v.kind).toBe("tolak");
    if (v.kind === "tolak") expect(v.alasan).toContain("kurang dari tagihan");
  });

  // Arah sebaliknya sengaja diterima: uangnya sudah masuk, dan menolak justru
  // meninggalkan pesanan menggantung padahal pembeli sudah membayar.
  it("lebih bayar tetap dianggap lunas", () => {
    expect(xenditWebhookVerdict({ ...dasar, paidAmount: 95000 })).toEqual({ kind: "lunas" });
  });

  // Token Xendit statis dan dipakai bersama semua webhook. Kalau ia bocor,
  // pencocokan invoice inilah yang mencegah satu request menandai pembayaran
  // mana pun lunas hanya dengan menyebut external_id-nya.
  it("invoice yang tidak cocok ditolak", () => {
    const v = xenditWebhookVerdict({ ...dasar, invoiceId: "inv-punya-orang-lain" });
    expect(v.kind).toBe("tolak");
    if (v.kind === "tolak") expect(v.alasan).toContain("Invoice tidak cocok");
  });

  it("EXPIRED menandai gagal", () => {
    expect(xenditWebhookVerdict({ ...dasar, status: "EXPIRED" })).toEqual({ kind: "gagal" });
  });

  it.each(["PENDING", "UNKNOWN", ""])("status %s diabaikan, bukan ditebak", (status) => {
    expect(xenditWebhookVerdict({ ...dasar, status })).toEqual({ kind: "abaikan" });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["NaN", Number.NaN],
  ])("nominal %s ditolak, bukan dianggap nol yang lolos", (_l, paidAmount) => {
    expect(xenditWebhookVerdict({ ...dasar, paidAmount: paidAmount as any }).kind).toBe("tolak");
  });
});
