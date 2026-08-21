import { describe, it, expect } from "vitest";
import { TOKEN_TTL_SEC } from "@repo/shared";

import { authCookie, clearedAuthCookie, getAuthToken, AUTH_COOKIE } from "./session";

// Cookie sesi pelanggan pernah terbit tanpa flag Secure — bug yang tidak
// terlihat dari UI mana pun dan hanya ketahuan dengan memeriksa header.
describe("cookie sesi pelanggan", () => {
  it("selalu HttpOnly, Secure, dan SameSite=Lax", () => {
    const c = authCookie("token-abc");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
  });

  // Cookie dan token pernah tidak selaras — cookie 1 hari, token 7 hari —
  // sehingga token tetap sah lama setelah browser berhenti mengirimkannya.
  it("umurnya mengikuti umur token pelanggan, bukan angka tersendiri", () => {
    expect(authCookie("t")).toContain(`Max-Age=${TOKEN_TTL_SEC.customer}`);
  });

  it("versi hapus memakai flag yang sama dengan Max-Age=0", () => {
    const c = clearedAuthCookie();
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("Secure");
    expect(c).toContain("HttpOnly");
  });

  it("membaca token dari header Cookie", () => {
    const req = new Request("https://toko.test", {
      headers: { Cookie: `${AUTH_COOKIE}=abc123; lain=xyz` },
    });
    expect(getAuthToken(req)).toBe("abc123");
  });

  it("mengembalikan string kosong kalau tidak ada cookie", () => {
    expect(getAuthToken(new Request("https://toko.test"))).toBe("");
  });
});
