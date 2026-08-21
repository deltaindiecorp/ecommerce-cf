import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { apiFetch, formatApiError } from "./api";

const req = (cookie?: string) =>
  new Request("https://toko.test/", cookie ? { headers: { Cookie: cookie } } : undefined);

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  // Kegagalan dicatat ke log server; dibungkam supaya output test bersih.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("apiFetch", () => {
  it("mengembalikan body pada respons sukses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({ success: true, data: [1, 2] })));
    await expect(apiFetch(req(), "/api/x")).resolves.toEqual({ success: true, data: [1, 2] });
  });

  // 4xx membawa pesan yang bisa ditindaklanjuti pembeli (stok habis, voucher
  // tidak berlaku) — halaman harus bisa menampilkannya, bukan jatuh ke error.
  it("mengembalikan 4xx apa adanya alih-alih melempar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({ success: false, error: "Stok habis" }, 400)));
    await expect(apiFetch(req(), "/api/x")).resolves.toMatchObject({ success: false, error: "Stok habis" });
  });

  it("menempelkan Authorization hanya kalau ada cookie", async () => {
    // Response baru tiap panggilan — body hanya bisa dibaca sekali.
    const spy = vi.fn().mockImplementation(async () => jsonRes({ success: true }));
    vi.stubGlobal("fetch", spy);

    await apiFetch(req("auth_token=abc"), "/api/x");
    expect((spy.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer abc" });

    await apiFetch(req(), "/api/x");
    expect((spy.mock.calls[1][1] as RequestInit).headers).not.toHaveProperty("Authorization");
  });
});

// Properti keamanan, bukan sekadar kosmetik: Remix menyerialkan pesan yang
// dilempar ke dokumen HTML untuk hidrasi, jadi apa pun di dalamnya terbaca
// semua pengunjung lewat view-source. Versi pertama menyebut URL API dan
// `localhost:8787` benar-benar muncul di sumber halaman.
describe("kegagalan tidak membocorkan detail internal", () => {
  async function pesanErrorDari(fetchImpl: () => Promise<Response>): Promise<string> {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(fetchImpl));
    try {
      await apiFetch(req(), "/api/rahasia");
      throw new Error("seharusnya melempar");
    } catch (e) {
      expect(e).toBeInstanceOf(Response);
      return await (e as Response).text();
    }
  }

  it("API tidak terjangkau", async () => {
    const pesan = await pesanErrorDari(() => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:8787")));
    expect(pesan).not.toContain("8787");
    expect(pesan).not.toContain("/api/rahasia");
    expect(pesan).not.toContain("ECONNREFUSED");
  });

  it("respons non-JSON", async () => {
    const pesan = await pesanErrorDari(async () =>
      new Response("<html><body>Cloudflare Error 1016 — origin di 10.0.0.5</body></html>", { status: 200 }));
    expect(pesan).not.toContain("10.0.0.5");
    expect(pesan).not.toContain("Cloudflare");
    expect(pesan).not.toContain("/api/rahasia");
  });

  it("error 5xx dari API", async () => {
    const pesan = await pesanErrorDari(async () => jsonRes({ success: false, error: "stack trace internal" }, 503));
    expect(pesan).not.toContain("stack trace internal");
    expect(pesan).not.toContain("/api/rahasia");
  });

  it("tetap memberi status 502 supaya ErrorBoundary bisa membedakannya", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("mati")));
    await apiFetch(req(), "/api/x").catch((e: Response) => {
      expect(e.status).toBe(502);
    });
  });
});

describe("formatApiError", () => {
  it("meneruskan pesan string apa adanya", () => {
    expect(formatApiError("Stok habis")).toBe("Stok habis");
  });

  it("menerjemahkan hasil zod flatten jadi 'field: pesan'", () => {
    const out = formatApiError({ formErrors: [], fieldErrors: { email: ["Format email tidak valid"] } });
    expect(out).toBe("email: Format email tidak valid");
  });

  it("menggabungkan beberapa field", () => {
    const out = formatApiError({ fieldErrors: { a: ["x"], b: ["y", "z"] } });
    expect(out).toContain("a: x");
    expect(out).toContain("b: y, z");
  });

  it("mengembalikan string kosong untuk null/undefined", () => {
    expect(formatApiError(null)).toBe("");
    expect(formatApiError(undefined)).toBe("");
  });
});
