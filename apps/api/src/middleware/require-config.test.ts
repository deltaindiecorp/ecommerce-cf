import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";

import { requireRuntimeConfig } from "./require-config";

// Penjaga ini adalah jaring pengaman terakhir untuk kesalahan konfigurasi yang
// sebelumnya muncul sebagai "Internal server error" tanpa petunjuk. Diuji lewat
// app Hono sungguhan supaya perilaku middleware-nya benar-benar terpakai.
function makeApp() {
  const app = new Hono<{ Bindings: { JWT_SECRET: string } }>();
  app.use("/api/*", requireRuntimeConfig);
  app.get("/api/ping", (c) => c.json({ success: true, pong: true }));
  app.get("/", (c) => c.json({ status: "ok" }));
  return app;
}

const VALID_SECRET = "x".repeat(48);

afterEach(() => vi.restoreAllMocks());

describe("requireRuntimeConfig", () => {
  it("menolak request saat JWT_SECRET kosong", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await makeApp().request("/api/ping", {}, { JWT_SECRET: "" });

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ success: false });
  });

  it("menolak request saat JWT_SECRET tidak diset sama sekali", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await makeApp().request("/api/ping", {}, {});

    expect(res.status).toBe(503);
  });

  it("menolak JWT_SECRET yang hanya berisi spasi", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await makeApp().request("/api/ping", {}, { JWT_SECRET: "   " });

    expect(res.status).toBe(503);
  });

  it("menyebut nama secret dan cara menyetelnya di log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await makeApp().request("/api/ping", {}, { JWT_SECRET: "" });

    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("JWT_SECRET");
    expect(logged).toContain("wrangler secret put");
    // Penyebab aslinya (blok [vars] menimpa secret) harus ikut disebut, karena
    // itu yang paling sulit ditebak sendiri oleh orang yang kena.
    expect(logged).toContain("[vars]");
  });

  it("meneruskan request saat JWT_SECRET valid", async () => {
    const res = await makeApp().request("/api/ping", {}, { JWT_SECRET: VALID_SECRET });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pong: true });
  });

  it("memperingatkan secret pendek tapi tetap meneruskan", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await makeApp().request("/api/ping", {}, { JWT_SECRET: "pendek" });

    expect(res.status).toBe(200);
    expect(spy.mock.calls.flat().join(" ")).toContain("JWT_SECRET");
  });

  it("tidak menghalangi health check di luar /api/*", async () => {
    const res = await makeApp().request("/", {}, { JWT_SECRET: "" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });
});
