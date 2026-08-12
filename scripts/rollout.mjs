#!/usr/bin/env node
// ─── Rollout ke semua klien ───────────────────────────────────────────────────
//
//   pnpm rollout                      # semua profil
//   pnpm rollout --profiles=meadza,larizq
//   pnpm rollout --dry-run            # lihat rencananya tanpa menyentuh apa pun
//   pnpm rollout --only=admin         # bagian tertentu saja, diteruskan ke deploy.mjs
//
// scripts/deploy.mjs menyasar satu klien. Setelah perbaikan masuk ke template,
// pekerjaannya bukan "deploy", tapi "deploy yang sama ke sepuluh klien tanpa ada
// yang terlewat" — dan yang terlewat tidak terlihat: klien itu hanya tetap
// berjalan di versi lama sampai ada yang mengeluh.
//
// Tiga hal yang membuat ini lebih dari sekadar for-loop:
//
//   1. Semua profil diperiksa DULU sebelum satu pun disentuh. Profil keempat yang
//      rusak lebih baik ketahuan sebelum klien pertama di-deploy.
//   2. Config tiap profil dirender ulang dari template terbaru. Setelah template
//      berubah, SEMUA profil butuh render ulang; menyuruh orang mengetiknya N kali
//      adalah persis pekerjaan yang mau dihapus di sini.
//   3. Migrasi dijalankan per klien sebelum Worker-nya naik, bukan sesudah —
//      alasan urutannya ada di scripts/check-deploy-config.mjs.

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { generate } from "./gen-wrangler.mjs";
import { ROOT, listProfiles, loadProfile, missingResourceIds } from "./profile.mjs";

const BLUE = "\x1b[1;34m", GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", OFF = "\x1b[0m";

const argv = process.argv.slice(2);
const flag = (nama) => argv.includes(`--${nama}`);
const nilai = (nama) => argv.find((a) => a.startsWith(`--${nama}=`))?.slice(nama.length + 3);

const dryRun      = flag("dry-run");
const keepGoing   = flag("keep-going");
const skipMigrate = flag("skip-migrate");
const bagian      = nilai("only");           // diteruskan apa adanya ke deploy.mjs
const pilihan     = nilai("profiles")?.split(",").map((s) => s.trim()).filter(Boolean);

const fail = (msg) => { console.error(`\n${RED}✘${OFF} ${msg}\n`); process.exit(1); };

function run(args, { cwd = ROOT } = {}) {
  execFileSync("node", args, { cwd, stdio: "inherit", env: process.env });
}

// ─── Pilih & periksa profil ───────────────────────────────────────────────────

const semua = listProfiles();
if (semua.length === 0) {
  fail("Belum ada satu pun profil di deployments/. Buat lewat: ./scripts/setup.sh <nama>");
}

const target = pilihan ?? semua;
const asing = target.filter((n) => !semua.includes(n));
if (asing.length) fail(`Profil tidak ditemukan: ${asing.join(", ")}\n  Yang ada: ${semua.join(", ")}`);

console.log(`\n${BLUE}Rollout ke ${target.length} profil${OFF}: ${target.join(", ")}`);
if (dryRun) console.log(`${DIM}(dry run — tidak ada yang benar-benar dijalankan)${OFF}`);

const masalah = [];
for (const nama of target) {
  try {
    const p = loadProfile(nama);
    const kurang = missingResourceIds(p);
    if (kurang.length) masalah.push(`${nama}: ID resource belum ada (${kurang.join(", ")}) — jalankan ./scripts/setup.sh ${nama}`);
  } catch (err) {
    masalah.push(`${nama}: ${err.message.split("\n")[0]}`);
  }
}
if (masalah.length) {
  fail("Profil berikut belum siap, jadi tidak ada satu pun yang di-deploy:\n\n" + masalah.map((m) => `  · ${m}`).join("\n"));
}

// ─── Jalankan ─────────────────────────────────────────────────────────────────

const hasil = [];
let berhenti = false;

for (const nama of target) {
  if (berhenti) { hasil.push({ nama, status: "dilewati" }); continue; }

  console.log(`\n${BLUE}${"─".repeat(70)}${OFF}`);
  console.log(`${BLUE}▶ ${nama}${OFF}  (${hasil.length + 1}/${target.length})`);
  console.log(`${BLUE}${"─".repeat(70)}${OFF}`);

  const mulai = Date.now();
  try {
    if (dryRun) {
      console.log(`${DIM}akan: render config → ${skipMigrate ? "" : "migrasi D1 remote → "}deploy${bagian ? ` (--only=${bagian})` : ""}${OFF}`);
    } else {
      const { missing } = generate(nama);
      if (missing.length) throw new Error(`ID resource belum lengkap: ${missing.join(", ")}`);
      console.log(`${DIM}✓ config dirender ulang dari template terbaru${OFF}`);

      if (!skipMigrate) {
        run([join(ROOT, "scripts", "db-migrate.mjs"), "apply", "--remote", "--profile", nama]);
      }
      run([join(ROOT, "scripts", "deploy.mjs"), "--profile", nama, ...(bagian ? [`--only=${bagian}`] : [])]);
    }
    hasil.push({ nama, status: "berhasil", detik: Math.round((Date.now() - mulai) / 1000) });
  } catch (err) {
    hasil.push({ nama, status: "gagal", detik: Math.round((Date.now() - mulai) / 1000), pesan: String(err.message).split("\n")[0] });
    if (!keepGoing) {
      berhenti = true;
      console.error(
        `\n${RED}Rollout dihentikan di "${nama}".${OFF}\n` +
        `Sisanya tidak dijalankan supaya kegagalan yang sama tidak menyebar ke klien lain.\n` +
        `Perbaiki dulu, lalu ulangi hanya yang tersisa:\n\n` +
        `  pnpm rollout --profiles=${target.slice(target.indexOf(nama)).join(",")}\n\n` +
        `Atau teruskan apa adanya dengan --keep-going.`,
      );
    }
  }
}

// ─── Ringkasan ────────────────────────────────────────────────────────────────

console.log(`\n${BLUE}${"─".repeat(70)}${OFF}`);
console.log(`${BLUE}Ringkasan rollout${OFF}\n`);
for (const r of hasil) {
  const tanda = r.status === "berhasil" ? `${GREEN}✓${OFF}` : r.status === "gagal" ? `${RED}✘${OFF}` : `${YELLOW}·${OFF}`;
  const durasi = r.detik != null ? `${DIM}${r.detik}s${OFF}` : "";
  console.log(`  ${tanda} ${r.nama.padEnd(20)} ${r.status.padEnd(10)} ${durasi}${r.pesan ? ` ${DIM}${r.pesan}${OFF}` : ""}`);
}

const gagal = hasil.filter((r) => r.status === "gagal");
const dilewati = hasil.filter((r) => r.status === "dilewati");
console.log("");
if (gagal.length === 0 && dilewati.length === 0) {
  console.log(`${GREEN}✓${OFF} ${hasil.length} profil selesai.\n`);
} else {
  console.log(`${gagal.length} gagal, ${dilewati.length} dilewati, ${hasil.length - gagal.length - dilewati.length} berhasil.\n`);
  process.exit(1);
}
