import { describe, it, expect } from "vitest";

import { adminRouter } from "./admin";
import { signJwt } from "../middleware/auth";
import { makeRecordingD1 } from "../test-utils/fake-d1";

const JWT_SECRET = "rahasia-uji-yang-cukup-panjang-untuk-hmac";

async function adminHeaders() {
  const token = await signJwt({ sub: "admin-1", role: "admin" }, JWT_SECRET);
  return { Authorization: `Bearer ${token}` };
}

describe("GET /api/admin/orders", () => {
  it("mengambil relasi user supaya nama pembeli terdaftar ikut terkirim", async () => {
    const d1 = makeRecordingD1({ JWT_SECRET });
    const res = await adminRouter.request("/orders", { headers: await adminHeaders() }, d1.env);

    expect(res.status).toBe(200);
    // Tanpa relasi ini, panel admin selalu jatuh ke fallback "Customer"/"—"
    // untuk pembeli terdaftar, karena mereka tidak mengisi kolom guest_*.
    expect(d1.allSql()).toContain("users");
  });

  it("tidak pernah meng-query kolom password", async () => {
    const d1 = makeRecordingD1({ JWT_SECRET });
    await adminRouter.request("/orders", { headers: await adminHeaders() }, d1.env);

    // `user: true` polos akan menarik seluruh kolom users termasuk hash password
    // ke browser admin. Proyeksi kolom di ORDER_USER_COLUMNS mencegahnya.
    expect(d1.allSql()).not.toContain("password");
  });

  it("detail order juga mengambil user tanpa password", async () => {
    const d1 = makeRecordingD1({ JWT_SECRET });
    await adminRouter.request("/orders/order-1", { headers: await adminHeaders() }, d1.env);

    expect(d1.allSql()).toContain("users");
    expect(d1.allSql()).not.toContain("password");
  });

  it("menolak request tanpa token", async () => {
    const d1 = makeRecordingD1({ JWT_SECRET });
    const res = await adminRouter.request("/orders", {}, d1.env);

    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(d1.executed).toHaveLength(0);
  });

  it("menolak token role customer", async () => {
    const d1    = makeRecordingD1({ JWT_SECRET });
    const token = await signJwt({ sub: "u-1", role: "customer" }, JWT_SECRET);
    const res   = await adminRouter.request(
      "/orders", { headers: { Authorization: `Bearer ${token}` } }, d1.env,
    );

    expect(res.status).toBe(403);
    expect(d1.executed).toHaveLength(0);
  });
});
