import { describe, it, expect } from "vitest";

import {
  isResiPollDue,
  RESI_POLL_INTERVAL_SEC,
  RESI_POLL_MAX_AGE_DAYS,
  RESI_POLL_DEFAULT_INTERVAL_SEC,
} from "./constants";

// Logika inilah yang menentukan tagihan Binderbyte: tiap "true" di sini berarti
// satu panggilan berbayar (15 credit). Sebelumnya tidak ada penyaring sama
// sekali — cron memanggil SETIAP kiriman aktif tiap 30 menit.
const SEKARANG = new Date("2026-08-20T12:00:00Z");
const jamLalu = (n: number) => new Date(SEKARANG.getTime() - n * 3_600_000);
const hariLalu = (n: number) => new Date(SEKARANG.getTime() - n * 86_400_000);

const due = (o: Partial<Parameters<typeof isResiPollDue>[0]>) =>
  isResiPollDue({
    status: "in_transit",
    lastChecked: jamLalu(1),
    createdAt: hariLalu(1),
    now: SEKARANG,
    ...o,
  });

describe("kapan resi layak dicek lagi", () => {
  it("selalu dicek kalau belum pernah dicek sama sekali", () => {
    expect(due({ lastChecked: null })).toBe(true);
    expect(due({ lastChecked: undefined })).toBe(true);
  });

  // Inti perbaikannya: cron tetap 30 menit, tapi kiriman yang baru saja dicek
  // tidak ikut ditagihkan lagi.
  it("dilewati kalau baru saja dicek", () => {
    expect(due({ status: "in_transit", lastChecked: jamLalu(0.5) })).toBe(false);
    expect(due({ status: "in_transit", lastChecked: jamLalu(5) })).toBe(false);
  });

  it("dicek lagi setelah jedanya lewat", () => {
    expect(due({ status: "in_transit", lastChecked: jamLalu(6) })).toBe(true);
    expect(due({ status: "in_transit", lastChecked: jamLalu(7) })).toBe(true);
  });

  // out_for_delivery paling sering berubah dan paling sering ditanyakan pembeli,
  // jadi ia sengaja dibiarkan jauh lebih responsif daripada yang lain.
  it("out_for_delivery jauh lebih sering daripada waiting_pickup", () => {
    expect(due({ status: "out_for_delivery", lastChecked: jamLalu(1.5) })).toBe(true);
    expect(due({ status: "waiting_pickup", lastChecked: jamLalu(1.5) })).toBe(false);
    expect(RESI_POLL_INTERVAL_SEC.out_for_delivery)
      .toBeLessThan(RESI_POLL_INTERVAL_SEC.waiting_pickup);
  });

  it("status tak dikenal memakai jeda bawaan, bukan dicek terus-menerus", () => {
    const jamBawaan = RESI_POLL_DEFAULT_INTERVAL_SEC / 3600;
    expect(due({ status: "entah_apa", lastChecked: jamLalu(jamBawaan - 1) })).toBe(false);
    expect(due({ status: "entah_apa", lastChecked: jamLalu(jamBawaan + 1) })).toBe(true);
  });

  // Tanpa batas ini, satu resi yang nyangkut di sistem kurir terus ditagihkan
  // sampai ada yang menyadarinya.
  it("berhenti setelah terlalu tua", () => {
    expect(due({ createdAt: hariLalu(RESI_POLL_MAX_AGE_DAYS - 1), lastChecked: null })).toBe(true);
    expect(due({ createdAt: hariLalu(RESI_POLL_MAX_AGE_DAYS + 1), lastChecked: null })).toBe(false);
  });

  it("umur tua menang atas 'belum pernah dicek'", () => {
    expect(due({ createdAt: hariLalu(60), lastChecked: null })).toBe(false);
  });

  // Timestamp D1 bisa datang sebagai angka detik, bukan Date. Salah menafsirkan
  // satuannya membuat jeda meleset ribuan kali lipat — ke arah yang salah, yaitu
  // memanggil terus-menerus.
  it("menerima timestamp detik maupun milidetik", () => {
    const enamJamLalu = jamLalu(6);
    expect(due({ lastChecked: enamJamLalu.getTime() })).toBe(true);
    expect(due({ lastChecked: Math.floor(enamJamLalu.getTime() / 1000) })).toBe(true);

    const setengahJamLalu = jamLalu(0.5);
    expect(due({ lastChecked: setengahJamLalu.getTime() })).toBe(false);
    expect(due({ lastChecked: Math.floor(setengahJamLalu.getTime() / 1000) })).toBe(false);
  });

  // Jam server yang mundur pernah membuat sistem sejenis membeku diam-diam:
  // lastChecked di masa depan berarti selisihnya negatif dan tidak pernah
  // mencapai jeda, sehingga kiriman itu tidak pernah diperiksa lagi.
  it("lastChecked dari masa depan tidak membekukan polling", () => {
    expect(due({ lastChecked: new Date(SEKARANG.getTime() + 86_400_000) })).toBe(true);
  });

  it("createdAt kosong tidak dianggap kedaluwarsa", () => {
    expect(due({ createdAt: null, lastChecked: null })).toBe(true);
  });
});

describe("besaran penghematannya", () => {
  // Angka inilah alasan perubahan ini ada. Cron 30 menit = 48 kesempatan/hari;
  // yang benar-benar jadi panggilan berbayar hanya sebagian kecil.
  it("in_transit ditagihkan 4x sehari, bukan 48x", () => {
    let panggilan = 0;
    let terakhir: Date | null = null;

    for (let i = 0; i < 48; i++) {
      const saat = new Date(SEKARANG.getTime() + i * 30 * 60_000);
      if (isResiPollDue({ status: "in_transit", lastChecked: terakhir, createdAt: SEKARANG, now: saat })) {
        panggilan++;
        terakhir = saat;
      }
    }

    expect(panggilan).toBe(4);          // 24 jam / jeda 6 jam
    expect(panggilan).toBeLessThan(48); // sebelumnya: tiap kali cron jalan
  });
});
