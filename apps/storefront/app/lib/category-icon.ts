// Pemetaan kategori -> ikon berdasarkan kata kunci di nama/slug. Dipakai untuk
// quick-nav kategori berbentuk lingkaran (ringkas & tidak bergantung imageUrl
// yang sering kosong). Tidak ada kolom "icon" di schema, jadi ini pendekatan
// heuristik sederhana, bukan data terstruktur.
const ICON_RULES: Array<[RegExp, string]> = [
  [/elektronik|gadget|handphone|hp\b/i, "📱"],
  [/fashion|pakaian|baju|busana/i,      "👕"],
  [/kecantikan|beauty|kosmetik/i,       "💄"],
  [/rumah|furniture|dekor/i,            "🏠"],
  [/olahraga|sport|fitness/i,           "⚽"],
  [/makanan|minuman|food|kuliner/i,     "🍽️"],
  [/buku|alat tulis|stationery/i,       "📚"],
  [/otomotif|mobil|motor|car\b/i,       "🚗"],
  [/mainan|hobi|gaming|game/i,          "🧸"],
];

export function getCategoryIcon(name: string): string {
  const match = ICON_RULES.find(([pattern]) => pattern.test(name));
  return match ? match[1] : "🏷️";
}
