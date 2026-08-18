import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { parseRajaOngkirTracking, describeShape, isDelivered, trackWaybill } from "./tracking";

// Bentuk respons SUKSES track/waybill belum pernah terlihat — empat resi
// sungguhan yang diuji semuanya dijawab "Invalid Awb". Jadi yang dikunci di sini
// bukan "parsernya menebak dengan benar", melainkan sesuatu yang jauh lebih
// penting: parser TAHU kapan tebakannya meleset, dan mengatakannya.
//
// Selama sifat itu terjaga, tebakan yang salah cuma berarti biaya Binderbyte
// seperti hari ini — bukan status pengiriman yang diam selamanya.
describe("parser pelacakan RajaOngkir", () => {
  it("membaca bentuk yang diharapkan", () => {
    const r = parseRajaOngkirTracking("JP123", "jnt", {
      data: {
        summary: { status: "DELIVERED" },
        manifest: [
          { manifest_date: "2026-08-18", manifest_description: "Diterima di kantor", city_name: "JAKARTA" },
        ],
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status.status).toBe("DELIVERED");
    expect(r.status.history[0]).toEqual({
      date: "2026-08-18",
      description: "Diterima di kantor",
      location: "JAKARTA",
    });
  });

  it.each([
    ["history/desc/location", { summary: { status: "ON PROCESS" }, history: [{ date: "d", desc: "x", location: "BDG" }] }],
    ["detail sebagai ringkasan", { detail: { status: "TRANSIT" }, manifest: [] }],
    ["status di akar", { status: "DELIVERED", manifest: [] }],
  ])("mengenali variasi penamaan: %s", (_l, data) => {
    expect(parseRajaOngkirTracking("X", "jne", { data }).ok).toBe(true);
  });

  // Inti keamanannya. Respons berisi data tapi status tidak ketemu = nama field
  // yang ditebak meleset. Kalau ini diam-diam jadi "tidak ada pembaruan",
  // pengiriman tidak akan pernah ditandai selesai dan tidak ada yang tahu.
  it("mengaku tidak mengerti saat status tidak ketemu", () => {
    const r = parseRajaOngkirTracking("X", "jne", {
      data: { nama_field_tak_terduga: { keadaan: "SAMPAI" }, perjalanan: [] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    if (r.reason !== "tak-dikenal") return;
    // Bentuknya ikut dilaporkan supaya parser bisa dibetulkan dari log produksi,
    // tanpa perlu menebak lagi.
    expect(r.shape).toContain("nama_field_tak_terduga");
  });

  it.each([
    ["data null", { data: null }],
    ["tanpa data", {}],
    ["respons kosong", null],
  ])("membedakan 'resi belum ada' dari 'tidak dikenali': %s", (_l, body) => {
    const r = parseRajaOngkirTracking("X", "jne", body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("kosong");
  });

  it("status kosong atau spasi dianggap tidak dikenali, bukan sukses", () => {
    const r = parseRajaOngkirTracking("X", "jne", { data: { summary: { status: "   " } } });
    expect(r.ok).toBe(false);
  });
});

describe("describeShape", () => {
  // Log ini ikut terbaca operator dan tersimpan di Cloudflare. Ia harus cukup
  // untuk membetulkan parser, tapi TIDAK boleh membawa nama atau alamat
  // penerima.
  it("melaporkan nama field tanpa isinya", () => {
    const s = describeShape({
      summary: { status: "DELIVERED", penerima: "Budi Santoso" },
      manifest: [{ city_name: "JAKARTA SELATAN" }],
    });
    expect(s).toContain("summary");
    expect(s).toContain("status:string");
    expect(s).toContain("penerima:string");
    expect(s).not.toContain("Budi Santoso");
    expect(s).not.toContain("JAKARTA SELATAN");
  });

  it("menyebut panjang array tanpa membuka semua isinya", () => {
    expect(describeShape({ manifest: [{ a: 1 }, { a: 2 }, { a: 3 }] })).toContain("×3");
  });

  it("berhenti pada kedalaman tertentu supaya log tidak meledak", () => {
    expect(describeShape({ a: { b: { c: { d: { e: 1 } } } } })).toContain("{…}");
  });
});

describe("penilaian status terkirim", () => {
  it.each(["DELIVERED", "delivered to consignee", "Paket diterima", "TERKIRIM"])(
    "%s dianggap selesai", (s) => expect(isDelivered(s)).toBe(true));

  it.each(["ON PROCESS", "TRANSIT", "Dalam pengiriman", "", null, undefined])(
    "%s belum selesai", (s) => expect(isDelivered(s as any)).toBe(false));
});

// ─── Pemilihan jalur & jaring pengaman ────────────────────────────────────────
// Bagian ini yang menentukan BIAYA: tiap panggilan Binderbyte berbiaya 15 credit
// (Rp 15), sedangkan RajaOngkir gratis. Salah bercabang di sini tidak merusak
// data, tapi menagih terus-menerus tanpa ada yang menyadarinya.
describe("trackWaybill memilih provider", () => {
  const env = { RAJAONGKIR_API_KEY: "ro-key", BINDERBYTE_API_KEY: "bb-key" } as any;

  const jsonRes = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const panggilan = (): string[] =>
    (globalThis.fetch as any).mock.calls.map((c: any[]) => String(c[0]));

  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("kurir yang didukung dilacak lewat RajaOngkir, Binderbyte tidak disentuh", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      jsonRes({ data: { summary: { status: "DELIVERED" }, manifest: [] } })));

    const hasil = await trackWaybill(env, "JP1", "jne");
    expect(hasil?.status).toBe("DELIVERED");
    expect(panggilan().some((u: string) => u.includes("rajaongkir"))).toBe(true);
    expect(panggilan().some((u: string) => u.includes("binderbyte"))).toBe(false);
  });

  it("kurir di luar cakupan langsung ke Binderbyte", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      jsonRes({ status: 200, data: { summary: { courier_code: "sicepat", status: "ON PROCESS" }, history: [] } })));

    const hasil = await trackWaybill(env, "SC1", "sicepat");
    expect(hasil?.status).toBe("ON PROCESS");
    expect(panggilan().some((u: string) => u.includes("binderbyte"))).toBe(true);
    expect(panggilan().some((u: string) => u.includes("rajaongkir"))).toBe(false);
  });

  // Resi yang baru dibuat belum terdaftar di sistem kurir — itu keadaan wajar,
  // bukan kegagalan. Membayar Binderbyte untuk jawaban yang sama berarti setiap
  // pesanan baru menagih dua kali.
  it("resi belum terdaftar TIDAK memicu Binderbyte", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      jsonRes({ meta: { message: "Invalid Awb", code: 404 }, data: null }, 404)));

    expect(await trackWaybill(env, "BARU", "jne")).toBeNull();
    expect(panggilan().some((u: string) => u.includes("binderbyte"))).toBe(false);
  });

  // Inti jaring pengamannya: bentuk respons sukses belum pernah terverifikasi,
  // jadi kalau parser tidak mengenalinya, pelacakan tetap jalan lewat Binderbyte
  // alih-alih diam.
  it("bentuk tak dikenal jatuh ke Binderbyte, bukan hilang", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: any) =>
      String(url).includes("rajaongkir")
        ? jsonRes({ data: { bentuk_asing: { keadaan: "SAMPAI" } } })
        : jsonRes({ status: 200, data: { summary: { courier_code: "jne", status: "DELIVERED" }, history: [] } })));

    const hasil = await trackWaybill(env, "X", "jne");
    expect(hasil?.status).toBe("DELIVERED");
    expect(panggilan().some((u: string) => u.includes("binderbyte"))).toBe(true);
  });

  it("RajaOngkir error juga jatuh ke Binderbyte", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: any) =>
      String(url).includes("rajaongkir")
        ? jsonRes({ meta: { message: "Internal Server Error", code: 500 } }, 500)
        : jsonRes({ status: 200, data: { summary: { courier_code: "jne", status: "TRANSIT" }, history: [] } })));

    expect((await trackWaybill(env, "X", "jne"))?.status).toBe("TRANSIT");
    expect(panggilan().some((u: string) => u.includes("binderbyte"))).toBe(true);
  });
});
