import { describe, it, expect } from "vitest";

import { parseCostResponse, parseDestinationResponse } from "./shipping";

// Cuplikan di bawah adalah respons SUNGGUHAN dari
// https://rajaongkir.komerce.id/api/v1, direkam saat migrasi dari
// api.rajaongkir.com yang sudah mati. Bentuk inilah yang menentukan benar
// tidaknya ongkir yang ditagihkan ke pembeli, jadi ia dikunci di sini —
// kuota gratisnya 100 panggilan/hari, tidak untuk dihabiskan test.
const RESPONS_ONGKIR = {
  meta: { message: "Success Calculate Domestic Shipping cost", code: 200, status: "success" },
  data: [
    { name: "Jalur Nugraha Ekakurir (JNE)", code: "jne", service: "CTC", description: "JNE City Courier", cost: 10000, etd: "1 day" },
    { name: "Jalur Nugraha Ekakurir (JNE)", code: "jne", service: "JTR", description: "JNE Trucking", cost: 40000, etd: "3 day" },
    { name: "SiCepat Ekspres", code: "sicepat", service: "BEST", description: "Besok Sampai Tujuan", cost: 12000, etd: "1 day" },
    { name: "J&T Express", code: "jnt", service: "EZ", description: "Reguler", cost: 11000, etd: "2 day" },
  ],
};

const RESPONS_TUJUAN = {
  meta: { message: "Success Get Domestic Destinations", code: 200, status: "success" },
  data: [
    {
      id: 17596,
      label: "CEMPAKA PUTIH BARAT, CEMPAKA PUTIH, JAKARTA PUSAT, DKI JAKARTA, 10520",
      province_name: "DKI JAKARTA",
      city_name: "JAKARTA PUSAT",
      district_name: "CEMPAKA PUTIH",
      subdistrict_name: "CEMPAKA PUTIH BARAT",
      zip_code: "10520",
    },
  ],
};

describe("parsing tarif ongkir", () => {
  it("memetakan bentuk datar Komerce ke ShippingRate", () => {
    const rates = parseCostResponse(RESPONS_ONGKIR);
    expect(rates).toHaveLength(4);
    expect(rates[0]).toEqual({
      courier: "jne",
      courierName: "Jalur Nugraha Ekakurir (JNE)",
      service: "CTC",
      serviceName: "JNE City Courier",
      cost: 10000,
      etd: "1 day",
    });
  });

  // Membuktikan satu panggilan memang mengembalikan banyak kurir sekaligus —
  // itulah yang membuat 17 ekspedisi muat dalam kuota 100 hit/hari.
  it("membawa beberapa kurir dari satu respons", () => {
    const kurir = new Set(parseCostResponse(RESPONS_ONGKIR).map(r => r.courier));
    expect(kurir).toEqual(new Set(["jne", "sicepat", "jnt"]));
  });

  // Tarif nol berarti checkout bisa menetapkan ongkir gratis tanpa ada yang
  // menyadarinya — persis lubang yang ditutup saat ongkir dipindah ke server.
  it("membuang layanan tanpa tarif atau tanpa identitas", () => {
    const rates = parseCostResponse({
      meta: { code: 200, status: "success" },
      data: [
        { code: "jne", service: "REG", cost: 0, etd: "1 day" },
        { code: "", service: "REG", cost: 9000 },
        { code: "jne", service: "", cost: 9000 },
        { code: "jne", service: "OKE", cost: 9000, etd: "2 day" },
      ],
    });
    expect(rates.map(r => r.service)).toEqual(["OKE"]);
  });

  it("etd kosong tidak menghasilkan string kosong di UI", () => {
    const [r] = parseCostResponse({
      meta: { code: 200, status: "success" },
      data: [{ code: "jne", service: "REG", cost: 9000, etd: "   " }],
    });
    expect(r.etd).toBe("-");
  });

  it.each([
    ["data null", { meta: { code: 200 }, data: null }],
    ["data bukan array", { meta: { code: 200 }, data: {} }],
    ["tanpa data", { meta: { code: 200 } }],
    ["respons kosong", null],
  ])("mengembalikan daftar kosong untuk %s", (_l, body) => {
    expect(parseCostResponse(body)).toEqual([]);
  });
});

describe("parsing tujuan", () => {
  // ID sekarang level kelurahan (17596), bukan kota (152). Nilai lama yang
  // tersimpan di gudang tidak berlaku lagi di API ini.
  it("mengambil id kelurahan dan label siap baca", () => {
    const [d] = parseDestinationResponse(RESPONS_TUJUAN);
    expect(d.cityId).toBe(17596);
    expect(d.cityName).toContain("CEMPAKA PUTIH BARAT");
    expect(d.cityName).toContain("JAKARTA PUSAT");
    expect(d.province).toBe("DKI JAKARTA");
    expect(d.postalCode).toBe("10520");
  });

  it("membuang baris tanpa id — tidak bisa dipakai sebagai origin/destination", () => {
    const hasil = parseDestinationResponse({
      meta: { code: 200 },
      data: [{ label: "TANPA ID" }, { id: 0, label: "NOL" }, { id: 5, label: "SAH" }],
    });
    expect(hasil.map(d => d.cityId)).toEqual([5]);
  });

  it("mengembalikan daftar kosong untuk respons kosong", () => {
    expect(parseDestinationResponse({ meta: { code: 200 }, data: null })).toEqual([]);
    expect(parseDestinationResponse(null)).toEqual([]);
  });
});
