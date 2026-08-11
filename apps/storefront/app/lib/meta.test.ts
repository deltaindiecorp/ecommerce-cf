import { describe, it, expect } from "vitest";
import { pageTitle, storeNameFrom, FALLBACK_STORE_NAME } from "./meta";

const withStore = (name: string) => [{ id: "root", data: { store: { storeName: name } } }];

describe("judul halaman", () => {
  it("memakai nama toko dari loader root", () => {
    expect(pageTitle(withStore("Meadza"), "FAQ")).toEqual([{ title: "FAQ - Meadza" }]);
  });

  it("tanpa judul halaman, hasilnya nama toko saja", () => {
    expect(pageTitle(withStore("Meadza"))).toEqual([{ title: "Meadza" }]);
  });

  // Halaman statis dirender sebelum pengaturan sempat dimuat pada deployment
  // baru — judulnya tetap harus masuk akal, bukan "undefined".
  it.each([
    ["matches kosong", []],
    ["tanpa route root", [{ id: "routes/faq", data: {} }]],
    ["root tanpa data", [{ id: "root" }]],
    ["nama kosong", [{ id: "root", data: { store: { storeName: "   " } } }]],
  ])("jatuh ke nama bawaan saat %s", (_label, matches) => {
    expect(storeNameFrom(matches as any)).toBe(FALLBACK_STORE_NAME);
  });
});
