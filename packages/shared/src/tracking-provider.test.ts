import { describe, it, expect } from "vitest";

import {
  trackingProviderFor,
  RAJAONGKIR_COST_COURIERS,
  RAJAONGKIR_TRACK_COURIERS,
} from "./constants";

// Daftar kurir di bawah bukan salinan dokumentasi — RajaOngkir tidak
// mendokumentasikannya. Keduanya diperoleh dari pesan error API sendiri saat
// dikirimi kode yang tidak dikenal, lalu dikunci di sini supaya perbedaannya
// tidak diam-diam bergeser.
describe("pemilihan provider pelacakan", () => {
  it.each([...RAJAONGKIR_TRACK_COURIERS])("%s dilacak lewat RajaOngkir (gratis)", (c) => {
    expect(trackingProviderFor(c)).toBe("rajaongkir");
  });

  // Inti opsi A. SiCepat punya TARIF di RajaOngkir tapi tidak bisa DILACAK di
  // sana — kalau ini salah, pembeli SiCepat membayar lalu pesanannya tidak
  // pernah terlacak, tanpa error apa pun.
  it("sicepat jatuh ke Binderbyte meski tarifnya ada di RajaOngkir", () => {
    expect(RAJAONGKIR_COST_COURIERS).toContain("sicepat");
    expect(RAJAONGKIR_TRACK_COURIERS).not.toContain("sicepat");
    expect(trackingProviderFor("sicepat")).toBe("binderbyte");
  });

  it.each(["ncs", "rex", "rpx", "sentral", "star"])(
    "%s bisa dijual tapi dilacak lewat Binderbyte",
    (c) => {
      expect(RAJAONGKIR_COST_COURIERS).toContain(c);
      expect(trackingProviderFor(c)).toBe("binderbyte");
    },
  );

  it("kurir di luar kedua daftar jatuh ke Binderbyte", () => {
    // SPX (Shopee Express) tidak ada di daftar mana pun — ditemukan saat
    // mencoba melacak resi SPX sungguhan.
    expect(trackingProviderFor("spx")).toBe("binderbyte");
    expect(trackingProviderFor("kurir-baru")).toBe("binderbyte");
  });

  it("tidak peka huruf besar-kecil dan spasi", () => {
    expect(trackingProviderFor("JNE")).toBe("rajaongkir");
    expect(trackingProviderFor("  JnT  ")).toBe("rajaongkir");
  });

  // Kurir kosong tidak boleh diam-diam dianggap gratis; Binderbyte yang akan
  // menolaknya dengan pesan, bukan RajaOngkir yang menganggapnya valid.
  it("kurir kosong atau null jatuh ke Binderbyte", () => {
    expect(trackingProviderFor("")).toBe("binderbyte");
    expect(trackingProviderFor(null)).toBe("binderbyte");
    expect(trackingProviderFor(undefined)).toBe("binderbyte");
  });

  it("sepuluh kurir bisa dijual sekaligus dilacak gratis", () => {
    const gratis = RAJAONGKIR_COST_COURIERS.filter(c =>
      (RAJAONGKIR_TRACK_COURIERS as readonly string[]).includes(c));
    expect(gratis).toHaveLength(10);
  });
});
