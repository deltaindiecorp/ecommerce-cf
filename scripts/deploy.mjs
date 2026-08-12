#!/usr/bin/env node
// ─── Deploy satu klien ────────────────────────────────────────────────────────
//
//   pnpm run deploy:client meadza
//
// Menggantikan `turbo run deploy`, yang tidak punya cara menyebut klien mana
// yang dimaksud dan menjalankan ketiga app secara paralel — padahal urutannya
// justru menentukan benar-tidaknya hasil:
//
//   1. migrasi D1   (lihat penjelasan urutan di scripts/check-deploy-config.mjs)
//   2. Worker API
//   3. Pages storefront & admin
//
// Storefront dan admin memanggil API lewat VITE_API_BASE yang dibakar saat
// build, jadi keduanya harus dibangun ulang per klien — artefak build satu
// klien tidak bisa dipakai klien lain.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { ROOT, loadProfile, profileFromArgv, generatedTomlPath, missingResourceIds, wranglerEnv } from "./profile.mjs";

const BLUE = "\x1b[1;34m", RED = "\x1b[1;31m", DIM = "\x1b[2m", OFF = "\x1b[0m";
const log = (msg) => console.log(`\n${BLUE}==> ${msg}${OFF}`);
const die = (msg) => { console.error(`\n${RED}Deploy dibatalkan${OFF}\n${msg}\n`); process.exit(1); };

function run(cmd, args, { cwd = ROOT, env = {} } = {}) {
  console.log(`${DIM}$ ${cmd} ${args.join(" ")}${OFF}`);
  try {
    execFileSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  } catch (err) {
    die(`Gagal di: ${cmd} ${args.join(" ")}`);
  }
}

// Nama profil boleh ditulis sebagai posisi pertama supaya enak diketik
// (`deploy:client meadza`), selain lewat --profile.
const argv = process.argv.slice(2);
const name = profileFromArgv(argv) || argv.find((a) => !a.startsWith("--")) || "";

let profile;
try {
  profile = loadProfile(name);
} catch (err) {
  die(err.message);
}

const missing = missingResourceIds(profile);
if (missing.length) {
  die(
    `Profil "${name}" belum punya ID resource: ${missing.join(", ")}\n\n` +
    `Provisioning belum selesai. Jalankan:\n\n  ./scripts/setup.sh ${name}`,
  );
}

const config = generatedTomlPath(name);
if (!existsSync(config)) die(`Config deploy tidak ada. Jalankan:\n\n  ./scripts/setup.sh ${name}`);

// Akun Cloudflare profil ini. Wajib ikut ke SETIAP panggilan wrangler: klien
// yang punya akun sendiri dan klien yang menumpang akun agency dijalankan dari
// mesin yang sama, dan tanpa ini yang menentukan sasaran adalah akun yang
// kebetulan aktif — bukan profil yang sedang di-deploy.
const AKUN = wranglerEnv(profile);

const apiDir = join(ROOT, "apps", "api");
const hanya = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const jalankan = (bagian) => !hanya || hanya === bagian;

console.log(`\nDeploy profil ${BLUE}${name}${OFF}`);
console.log(`  Worker     : ${profile.WORKER_NAME}`);
console.log(`  Storefront : ${profile.PAGES_STOREFRONT}  → ${profile.STORE_URL}`);
console.log(`  Admin      : ${profile.PAGES_ADMIN}  → ${profile.ADMIN_URL}`);
console.log(`  API        : ${profile.API_BASE}`);
console.log(`  Akun CF    : ${profile.CLOUDFLARE_ACCOUNT_ID || "(akun yang sedang aktif di wrangler)"}`);

// ─── 1. Worker API ────────────────────────────────────────────────────────────
// check-deploy-config.mjs yang menahan kalau masih ada migrasi tertunda; ia
// dipanggil di sini supaya pemeriksaannya tidak bisa terlewat.
if (jalankan("api")) {
  log("Memeriksa config & migrasi");
  run("node", [join(ROOT, "scripts", "check-deploy-config.mjs"), "--profile", name]);

  log(`Deploy Worker: ${profile.WORKER_NAME}`);
  run("npx", ["wrangler", "deploy", "--config", config], { cwd: apiDir, env: AKUN });
}

// ─── 2. Pages ─────────────────────────────────────────────────────────────────
// --project-name menimpa `name` di apps/*/wrangler.toml, sehingga berkas
// ter-track itu tetap sama untuk semua klien.
function deployPages(app, projectName, viteEnv) {
  const dir = join(ROOT, "apps", app);

  log(`Build ${app} (VITE_API_BASE=${viteEnv.VITE_API_BASE})`);
  run("npx", ["remix", "vite:build"], { cwd: dir, env: viteEnv });

  log(`Deploy Pages: ${projectName}`);
  run("npx", ["wrangler", "pages", "deploy", "--project-name", projectName, "--commit-dirty=true"], { cwd: dir, env: AKUN });
}

if (jalankan("storefront")) {
  deployPages("storefront", profile.PAGES_STOREFRONT, { VITE_API_BASE: profile.API_BASE });
}

if (jalankan("admin")) {
  deployPages("admin", profile.PAGES_ADMIN, {
    VITE_API_BASE: profile.API_BASE,
    VITE_STORE_URL: profile.STORE_URL,
  });
}

console.log(`\n\x1b[32m✓\x1b[0m Deploy profil "${name}" selesai.`);
if (!hanya) {
  console.log(`
Cek cepat:
  curl ${profile.API_BASE}/
  buka ${profile.STORE_URL} dan ${profile.ADMIN_URL}

Kalau domain kustom belum diarahkan, Pages memakai
${profile.PAGES_STOREFRONT}.pages.dev dan ${profile.PAGES_ADMIN}.pages.dev.`);
}
