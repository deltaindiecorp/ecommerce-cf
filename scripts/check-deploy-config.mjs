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
