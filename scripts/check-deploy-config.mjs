#!/usr/bin/env node
// Penjaga sebelum `wrangler deploy` pada Worker API.
//
// Deploy memakai wrangler.generated.toml (hasil scripts/setup.sh), bukan
// wrangler.toml yang masih berisi placeholder. Tanpa penjaga ini, deploy dari
// clone yang belum di-setup akan lolos dengan binding menunjuk ID palsu —
// gagalnya baru terasa saat request pertama menyentuh D1.

import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { pendingMigrations } from "./db-migrate.mjs";

const here      = dirname(fileURLToPath(import.meta.url));
const apiDir    = resolve(here, "../apps/api");
const template  = resolve(apiDir, "wrangler.toml");
const generated = resolve(apiDir, "wrangler.generated.toml");

const die = (msg) => { console.error(`\n\x1b[1;31mDeploy dibatalkan\x1b[0m\n${msg}\n`); process.exit(1); };

if (!existsSync(generated)) {
  die(
    "apps/api/wrangler.generated.toml tidak ditemukan.\n\n" +
    "Berkas itu dibuat scripts/setup.sh dan berisi ID resource Cloudflare untuk\n" +
    "deployment ini. Jalankan dulu:\n\n" +
    "  ./scripts/setup.sh\n",
  );
}

// Template yang lebih baru berarti ada perubahan binding/config yang belum
// tercermin — misalnya setelah menarik perbaikan dari repo template.
if (statSync(template).mtimeMs > statSync(generated).mtimeMs) {
  die(
    "apps/api/wrangler.toml lebih baru daripada wrangler.generated.toml.\n\n" +
    "Kemungkinan ada binding atau konfigurasi baru dari template yang belum\n" +
    "masuk ke config deployment ini. Jalankan ulang:\n\n" +
    "  ./scripts/setup.sh\n",
  );
}

console.log("✓ wrangler.generated.toml siap dipakai deploy");

// ─── Migrasi harus lebih dulu ─────────────────────────────────────────────────
// Urutannya bukan selera. Migrasi 0004 menjalankan
// `UPDATE inventory SET qty_on_hand = qty_available` sebelum menjatuhkan
// qty_available. Kalau Worker baru naik lebih dulu, ia mulai menulis ke
// qty_on_hand, lalu migrasi menimpa angka-angka itu dengan isi qty_available
// yang sudah basi — stok tercatat salah tanpa error apa pun.
//
// Arah sebaliknya hanya menyisakan jendela pendek saat Worker lama bertemu skema
// baru dan gagal terang-terangan. Itu jauh lebih baik daripada rusak diam-diam.
if (process.env.SKIP_MIGRATION_CHECK === "1") {
  console.log("⚠ Pemeriksaan migrasi dilewati (SKIP_MIGRATION_CHECK=1)");
} else {
  let pending = null; // null = tidak terbaca, bukan "tidak ada"
  try {
    pending = pendingMigrations(true);
  } catch (err) {
    // Tidak bisa dibaca ≠ aman. Tapi juga bukan alasan memblokir deploy yang
    // mungkin sah — jadi diperingatkan, bukan dihentikan. Yang penting: JANGAN
    // mencetak tanda centang sesudah ini, karena tidak ada yang terverifikasi.
    const alasan = String(err.message).split("\n")[0].replace(/^Command failed: .*/, "wrangler gagal dijalankan");
    console.warn(`⚠ Status migrasi remote tidak terbaca: ${alasan}`);
    console.warn("  Deploy diteruskan, tapi pastikan sendiri `pnpm db:status:remote` bersih.");
  }

  if (pending && pending.length > 0) {
    die(
      `Ada ${pending.length} migrasi yang belum diterapkan ke D1 remote:\n\n` +
      pending.map((n) => `  · ${n}`).join("\n") +
      "\n\nJalankan migrasinya DULU, baru deploy Worker:\n\n" +
      "  pnpm db:migrate:remote\n\n" +
      "Urutan ini penting — deploy duluan bisa membuat migrasi menimpa data yang\n" +
      "baru ditulis Worker. Kalau kamu yakin ingin melewatinya: SKIP_MIGRATION_CHECK=1\n",
    );
  }
  if (pending) console.log("✓ Tidak ada migrasi tertunda di D1 remote");
}
