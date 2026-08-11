import { describe, it, expect } from "vitest";
import {
  wibDateKey, WIB_OFFSET_HOURS, SQLITE_WIB_MODIFIER,
  ORDER_STATUS_LABEL, ORDER_STATUS_COLOR, ORDER_STATUS_FILTERS,
  ORDER_STATUS_TRANSITIONS,
} from "./constants";

describe("wibDateKey", () => {
  // 2026-08-11T18:30:00Z = 2026-08-12 01:30 WIB — sudah ganti hari di Jakarta
  // meski di UTC masih tanggal 11. Inilah yang membuat definisi "hari" tidak
  // boleh punya dua implementasi.
  const malam = Date.parse("2026-08-11T18:30:00Z");

  it("memakai tanggal kalender WIB, bukan UTC", () => {
    expect(wibDateKey(0, malam)).toBe("2026-08-12");
  });

  it("offsetDays mundur per hari kalender", () => {
    expect(wibDateKey(1, malam)).toBe("2026-08-11");
    expect(wibDateKey(6, malam)).toBe("2026-08-06");
  });

  it("tetap di tanggal yang sama untuk siang WIB", () => {
    expect(wibDateKey(0, Date.parse("2026-08-11T05:00:00Z"))).toBe("2026-08-11");
  });

  it("modifier SQLite dibangun dari konstanta yang sama", () => {
    expect(SQLITE_WIB_MODIFIER).toBe(`+${WIB_OFFSET_HOURS} hours`);
  });
});

describe("konstanta status order", () => {
  const semua = Object.keys(ORDER_STATUS_TRANSITIONS);

  it("setiap status punya label dan warna", () => {
    for (const s of semua) {
      expect(ORDER_STATUS_LABEL[s], `label ${s}`).toBeTruthy();
      expect(ORDER_STATUS_COLOR[s], `warna ${s}`).toBeTruthy();
    }
  });

  it("chip filter mencakup semua status, termasuk refunded", () => {
    const filters = ORDER_STATUS_FILTERS.filter(Boolean);
    expect([...filters].sort()).toEqual([...semua].sort());
    expect(filters).toContain("refunded");
  });
});
