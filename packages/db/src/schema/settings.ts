import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ─── Pengaturan Toko ──────────────────────────────────────────────────────────
// Identitas toko dulu tertanam langsung di komponen storefront ("Deltacommerce"
// di header, footer, dan judul setiap halaman). Untuk template yang di-deploy
// per klien, itu berarti setiap toko klien menampilkan merek pembuat template
// sampai ada yang mengedit kodenya.
//
// Satu baris saja, id tetap. Bukan tabel key-value karena kolom bertipe memberi
// jaminan yang sama dengan schema lain di repo ini: salah nama field ketahuan
// saat type-check, bukan saat halaman dirender.
export const STORE_SETTINGS_ID = "default";

export const storeSettings = sqliteTable("store_settings", {
  id: text("id").primaryKey().$defaultFn(() => STORE_SETTINGS_ID),

  storeName: text("store_name").notNull().default("Deltacommerce"),
  tagline:   text("tagline"),

  supportEmail: text("support_email"),
  supportPhone: text("support_phone"),
  address:      text("address"),

  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
