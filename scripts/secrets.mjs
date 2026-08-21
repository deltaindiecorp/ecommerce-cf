#!/usr/bin/env node
// ─── Secret per profil ────────────────────────────────────────────────────────
//
//   node scripts/secrets.mjs scaffold --profile meadza
//   node scripts/secrets.mjs push     --profile meadza
//   node scripts/secrets.mjs list     --profile meadza
//
// Sebelumnya sembilan secret diisi satu per satu lewat `wrangler secret put`,
// masing-masing menunggu ketikan manual. Untuk satu klien itu merepotkan; untuk
// sepuluh klien itu sembilan puluh prompt, dan satu saja yang terlewat baru
// ketahuan saat login gagal di produksi — JWT_SECRET kosong membuat
// crypto.subtle.importKey melempar DataError dan seluruh auth mati.
//
// Di sini daftarnya diisi sekali di deployments/<profil>.secrets.env (tidak
// dilacak git, sama seperti profilnya), diperiksa kelengkapannya, lalu diunggah
// sekaligus lewat `wrangler secret bulk`.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_DIR, DEPLOYMENTS_DIR, ROOT,
  generatedTomlPath, loadProfile, parseEnvFile, profileFromArgv, wranglerEnv,
} from "./profile.mjs";

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", OFF = "\x1b[0m";
const fail = (msg) => { console.error(`${RED}✘${OFF} ${msg}`); process.exit(1); };

export const secretsPath = (name) => join(DEPLOYMENTS_DIR, `${name}.secrets.env`);

// Daftar secret hidup di apps/api/.dev.vars.example — berkas yang sudah dipakai
// dev lokal untuk hal yang sama. Membacanya dari sana, bukan menyalinnya ke
// sini, supaya menambah secret baru cukup di satu tempat.
const DEV_VARS_EXAMPLE = join(API_DIR, ".dev.vars.example");

// Sengaja tidak wajib: hanya dipakai sekali untuk membuat admin pertama, lalu
// justru harus dikosongkan lagi.
const OPSIONAL = new Set(["ADMIN_BOOTSTRAP_SECRET"]);

export function knownSecretKeys() {
  if (!existsSync(DEV_VARS_EXAMPLE)) throw new Error(`Tidak ketemu ${DEV_VARS_EXAMPLE}`);
  return readFileSync(DEV_VARS_EXAMPLE, "utf8")
    .split("\n")
    .map((l) => l.trim().match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter(Boolean);
}

// Dipisah dari pembacaan berkas supaya bisa diuji tanpa filesystem.
export function classifySecrets(isi, dikenal) {
  const wajib = dikenal.filter((k) => !OPSIONAL.has(k));
  return {
    terisi:      dikenal.filter((k) => (isi[k] ?? "") !== ""),
    kurang:      wajib.filter((k) => (isi[k] ?? "") === ""),
    takDikenal:  Object.keys(isi).filter((k) => !dikenal.includes(k)),
  };
}

function bacaSecrets(name) {
  const path = secretsPath(name);
  if (!existsSync(path)) {
    fail(
      `Berkas secret untuk profil "${name}" belum ada.\n` +
      `  Buat kerangkanya:  node scripts/secrets.mjs scaffold --profile ${name}`,
    );
  }
  return parseEnvFile(readFileSync(path, "utf8"));
}

// Secret melekat pada Worker di akun tertentu, jadi akun profil ikut diteruskan —
// tanpa itu rahasia klien bisa terpasang di Worker bernama sama milik akun lain.
function wrangler(args, { silent = false, akun = {} } = {}) {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: API_DIR,
    stdio: silent ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    env: { ...process.env, CI: "1", ...akun },
  });
}

function configFor(name) {
  const config = generatedTomlPath(name);
  if (!existsSync(config)) {
    fail(
      `Config deploy profil "${name}" belum ada.\n` +
      `  Secret melekat pada Worker, jadi nama Worker-nya harus diketahui dulu.\n` +
      `  Jalankan:  ./scripts/setup.sh ${name}`,
    );
  }
  return config;
}

// ─── Perintah ─────────────────────────────────────────────────────────────────

function cmdScaffold(name) {
  loadProfile(name); // memastikan profilnya memang ada sebelum menaruh berkas di sebelahnya
  const path = secretsPath(name);
  if (existsSync(path)) fail(`Sudah ada: ${path.replace(ROOT + "/", "")} — tidak ditimpa.`);

  const isi = [
    `# Secret untuk profil "${name}" — TIDAK dilacak git, jangan di-commit.`,
    "#",
    "# Isi semuanya, lalu unggah sekaligus:",
    `#   node scripts/secrets.mjs push --profile ${name}`,
    "#",
    "# Nilai kosong akan DILEWATI, bukan diunggah sebagai string kosong — secret",
    "# kosong lebih berbahaya daripada secret yang belum ada, karena ia menimpa",
    "# nilai lama tanpa ada yang gagal saat deploy.",
    "",
    ...knownSecretKeys().map((k) => (OPSIONAL.has(k) ? `# ${k}=   # sementara, kosongkan lagi setelah admin pertama dibuat` : `${k}=`)),
    "",
  ].join("\n");

  writeFileSync(path, isi, { mode: 0o600 });
  console.log(`${GREEN}✓${OFF} ${path.replace(ROOT + "/", "")}`);
  console.log(`  Isi nilainya, lalu: node scripts/secrets.mjs push --profile ${name}`);
}

function cmdPush(name) {
  const profil = loadProfile(name);
  const config = configFor(name);
  const isi = bacaSecrets(name);
  const { terisi, kurang, takDikenal } = classifySecrets(isi, knownSecretKeys());

  if (takDikenal.length) {
    // Bukan alasan berhenti — mungkin memang secret tambahan yang dipakai kode
    // klien ini. Tapi salah ketik nama juga terlihat persis seperti ini.
    console.warn(`${YELLOW}⚠${OFF} Tidak dikenal, tetap diunggah: ${takDikenal.join(", ")}`);
  }
  if (kurang.length) {
    fail(
      `Masih kosong: ${kurang.join(", ")}\n` +
      `  Lengkapi di deployments/${name}.secrets.env sebelum mengunggah.`,
    );
  }

  const kirim = [...terisi, ...takDikenal];
  console.log(`Mengunggah ${kirim.length} secret ke Worker ${profil.WORKER_NAME}:`);
  for (const k of kirim) console.log(`  · ${k}`);

  // Yang diunggah hanya kunci yang ada isinya, jadi berkas sementara dulu —
  // berisi rahasia, karena itu di direktori temp berizin 0700 milik user dan
  // dihapus apa pun yang terjadi.
  const dir = mkdtempSync(join(tmpdir(), "ecom-secrets-"));
  const berkas = join(dir, "secrets.env");
  let gagal = null;
  try {
    writeFileSync(berkas, kirim.map((k) => `${k}=${isi[k]}`).join("\n") + "\n", { mode: 0o600 });
    wrangler(["secret", "bulk", berkas, "--config", config], { akun: wranglerEnv(profil) });
  } catch (err) {
    gagal = err;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Dihapus dulu, baru menyerah: fail() memanggil process.exit(), dan itu
  // melewati blok finally — berkas berisi rahasia akan tertinggal di disk.
  if (gagal) fail("Gagal mengunggah secret — lihat pesan wrangler di atas.");

  console.log(`\n${GREEN}✓${OFF} Secret profil "${name}" terpasang.`);
  if (isi.ADMIN_BOOTSTRAP_SECRET) {
    console.log(
      `${YELLOW}⚠${OFF} ADMIN_BOOTSTRAP_SECRET ikut terpasang. Setelah admin pertama dibuat,\n` +
      `  hapus lagi:  cd apps/api && npx wrangler secret delete ADMIN_BOOTSTRAP_SECRET --config ${config.split("/").pop()}`,
    );
  }
}

function cmdList(name) {
  const profil = loadProfile(name);
  const config = configFor(name);
  console.log(`${DIM}Secret yang terpasang (nama saja — nilainya tidak bisa dibaca lagi):${OFF}`);
  wrangler(["secret", "list", "--config", config], { akun: wranglerEnv(profil) });
}

// ─── Entry ────────────────────────────────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const cmd = argv.find((a) => !a.startsWith("--"));
  // Nama profil boleh sebagai posisi kedua (`secrets push meadza`) selain --profile.
  const name = profileFromArgv(argv) || argv.filter((a) => !a.startsWith("--"))[1] || "";

  try {
    if (!cmd || !["scaffold", "push", "list"].includes(cmd)) {
      console.log(`
Secret per profil — diisi sekali di berkas, diunggah sekaligus.

  node scripts/secrets.mjs scaffold --profile <nama>   buat kerangka berkasnya
  node scripts/secrets.mjs push     --profile <nama>   unggah yang sudah terisi
  node scripts/secrets.mjs list     --profile <nama>   nama secret yang terpasang

Berkasnya: deployments/<nama>.secrets.env (tidak dilacak git).
`);
      process.exit(cmd ? 1 : 0);
    }
    if (!name) fail("Sebutkan profilnya: --profile <nama>");

    if (cmd === "scaffold") cmdScaffold(name);
    if (cmd === "push")     cmdPush(name);
    if (cmd === "list")     cmdList(name);
  } catch (err) {
    fail(err.message);
  }
}
