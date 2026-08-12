#!/usr/bin/env node
// ─── Migrasi D1 ───────────────────────────────────────────────────────────────
// Satu-satunya jalur migrasi. Sebelumnya ada tiga, dan tak satu pun mencatat apa
// yang sudah diterapkan:
//
//   1. scripts/setup.sh  — `for f in migrations/*.sql; wrangler d1 execute --file`
//      Benar sekali saja di database kosong. Dijalankan kedua kalinya ia gagal di
//      "duplicate column name" dan berhenti separuh jalan. Tidak ada cara
//      menerapkan HANYA yang baru.
//   2. README (dev lokal) — loop yang sama dengan --local.
//   3. `pnpm db:migrate` → `drizzle-kit migrate`, butuh CF_ACCOUNT_ID /
//      CF_D1_DATABASE_ID / CF_API_TOKEN yang tidak muncul di mana pun lagi di
//      repo ini, dan mencatat ke tabelnya sendiri (`__drizzle_migrations`) —
//      pelacak keempat yang tidak tahu-menahu soal tiga jalur lainnya.
//
// Sekarang semuanya lewat `wrangler d1 migrations apply`, yang mencatat di tabel
// `d1_migrations` dan hanya menjalankan yang belum. drizzle-kit tinggal dipakai
// untuk `generate` saja.
//
// Perintah:
//   node scripts/db-migrate.mjs status   [--local|--remote]
//   node scripts/db-migrate.mjs apply    [--local|--remote]
//   node scripts/db-migrate.mjs baseline [--local|--remote] [--write]

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generatedTomlPath, listProfiles, loadProfile, profileFromArgv, wranglerEnv } from "./profile.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_DIR = join(ROOT, "apps", "api");
const MIGRATIONS_DIR = join(ROOT, "packages", "db", "migrations");
const BINDING = "DB";

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", OFF = "\x1b[0m";
const fail = (msg) => { console.error(`${RED}✘${OFF} ${msg}`); process.exit(1); };
const info = (msg) => console.log(`${DIM}${msg}${OFF}`);

// ─── Sidik jari migrasi ───────────────────────────────────────────────────────
// Dipakai HANYA oleh `baseline`, untuk mengadopsi database yang migrasinya
// terlanjur dijalankan lewat loop buta di atas: kita perlu tahu sudah sampai
// mana tanpa punya catatan apa pun. Jadi keadaannya dibaca dari skema yang
// benar-benar ada, bukan diasumsikan.
//
// Migrasi baru tidak perlu ditambahkan ke sini — begitu sebuah database sudah
// di-baseline, semua migrasi berikutnya tercatat sendiri oleh wrangler. Daftar
// ini hanya menutup sepuluh migrasi yang sudah terlanjur beredar tanpa catatan.
const FINGERPRINTS = {
  "0000_amused_toad_men":        "table:users",
  "0001_needy_tombstone":        "table:vouchers",
  "0002_steep_hemingway":        "column:products.cost_price",
  "0003_medical_corsair":        "index:products_category_id_idx",
  // 0004 menjatuhkan kolom, jadi tandanya adalah ketiadaan — dipasangkan dengan
  // kolom yang ia tambahkan supaya tidak tertukar dengan "tabelnya belum ada".
  "0004_nervous_invisible_woman": "column:inventory_movements.created_by",
  "0005_young_vin_gonzales":     "column:products.track_inventory",
  "0006_fantastic_corsair":      "table:admin_audit_log",
  "0007_regular_richard_fisk":   "index:orders_user_id_idx",
  "0008_flowery_wendigo":        "column:orders.payment_method",
  "0009_flaky_the_fallen":       "table:store_settings",
};

function probeSql(spec) {
  const [kind, ref] = spec.split(":");
  if (kind === "table" || kind === "index") {
    return `SELECT count(*) FROM sqlite_master WHERE type='${kind}' AND name='${ref}'`;
  }
  const [table, column] = ref.split(".");
  return `SELECT count(*) FROM pragma_table_info('${table}') WHERE name='${column}'`;
}

// ─── Wrangler ─────────────────────────────────────────────────────────────────

// Remote selalu menunjuk satu klien tertentu, jadi profilnya wajib — tidak ada
// "database remote" tunggal di repo ini. Lokal justru sebaliknya: satu D1
// Miniflare dipakai bersama, dan placeholder di template tidak mengganggu.
// Satu perintah selalu menyasar satu database, jadi profilnya disimpan sekali
// di sini alih-alih diteruskan lewat setiap fungsi query di bawah.
let CURRENT_PROFILE = "";

function wranglerConfig(remote) {
  if (!remote) return join(API_DIR, "wrangler.toml");

  const name = CURRENT_PROFILE || profileFromArgv();
  if (!name) {
    fail(
      "Migrasi remote butuh profil deployment.\n" +
      "  Pakai --profile <nama>, atau set DEPLOY_PROFILE.\n" +
      (listProfiles().length
        ? `  Tersedia: ${listProfiles().join(", ")}`
        : "  Belum ada satu pun. Buat lewat: ./scripts/setup.sh <nama>"),
    );
  }

  const generated = generatedTomlPath(name);
  if (!existsSync(generated)) {
    fail(
      `Config deploy untuk profil "${name}" belum ada.\n` +
      `  Dibuat oleh: ./scripts/setup.sh ${name}`,
    );
  }
  return generated;
}

function wrangler(args, { remote, capture = false }) {
  const full = [...args, remote ? "--remote" : "--local", "--config", wranglerConfig(remote)];

  // Dihitung di luar try: kalau profilnya sendiri yang bermasalah, itu bukan
  // kegagalan wrangler dan tidak boleh dilaporkan sebagai kegagalan wrangler.
  // Lokal tidak menyentuh akun mana pun, jadi tidak perlu.
  const akun = remote ? wranglerEnv(loadProfile(CURRENT_PROFILE || profileFromArgv())) : {};

  try {
    const out = execFileSync("npx", ["wrangler", ...full], {
      cwd: API_DIR,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      env: { ...process.env, CI: "1", ...akun },
    });
    return out ?? "";
  } catch (err) {
    if (!capture) process.exit(err.status ?? 1);
    // wrangler menulis sebagian errornya ke stdout, dan stderr-nya bercampur
    // peringatan npm yang tidak ada hubungannya dengan kegagalan. Mengambil
    // baris pertama apa adanya pernah membuat "Unknown env config reporter"
    // terbaca sebagai penyebab error.
    const mentah = [err.stdout, err.stderr, err.message].map((x) => String(x ?? "")).join("\n");
    const berarti = mentah
      .split("\n")
      .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim())
      .filter((l) => l && !/^npm (warn|notice)/i.test(l) && !/^Command failed:/.test(l)
                     && !/wrangler \d|update available|^-+$|^▲|Please update|npm install|After installation/i.test(l))
      .slice(0, 6);

    // Dengan --json, wrangler membungkus errornya jadi objek; yang berguna bagi
    // pembaca cuma field "text".
    const teks = berarti
      .map((l) => l.match(/"text"\s*:\s*"(.+?)"/)?.[1])
      .filter(Boolean);

    throw new Error((teks.length ? teks : berarti).slice(0, 3).join("\n  ") || "wrangler gagal dijalankan");
  }
}

function queryRows(sql, remote) {
  const raw = wrangler(["d1", "execute", BINDING, "--json", "--command", sql], { remote, capture: true });
  return JSON.parse(raw)[0]?.results ?? [];
}

// Menjalankan satu query dan mengembalikan angka pertamanya. Sengaja satu query
// per panggilan: tiap panggilan remote adalah round-trip jaringan, tapi baseline
// hanya dijalankan sekali seumur hidup sebuah database.
function queryNumber(sql, remote) {
  const row = queryRows(sql, remote)[0];
  return Number(Object.values(row ?? {})[0] ?? 0);
}

function migrationNames() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => f.replace(/\.sql$/, ""));
}

function hasTrackingTable(remote) {
  return queryNumber("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='d1_migrations'", remote) > 0;
}

function isEmptyDatabase(remote) {
  return queryNumber(
    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
    remote,
  ) === 0;
}

// ─── Perintah ─────────────────────────────────────────────────────────────────

// Dirender sendiri, bukan diteruskan ke `wrangler d1 migrations list`, karena
// wrangler 3 menampilkan daftarnya dalam urutan acak (0008, 0005, 0000, …) dan
// membalas "No migrations to apply!" baik ketika semuanya sudah diterapkan
// maupun ketika ia tidak menemukan satu berkas pun — dua keadaan yang sangat
// berbeda. Penerapannya sendiri tetap berurutan; hanya tampilannya yang keliru.
function cmdStatus(remote) {
  const names = migrationNames();

  if (!hasTrackingTable(remote)) {
    if (isEmptyDatabase(remote)) {
      console.log(`Database kosong — ${names.length} migrasi menunggu.`);
      for (const n of names) console.log(`  ${YELLOW}·${OFF} ${n}`);
      return;
    }
    console.log(`${YELLOW}▲${OFF} Punya tabel tapi tidak punya catatan migrasi.`);
    console.log(`  Adopsi dulu: ${GREEN}node scripts/db-migrate.mjs baseline ${remote ? "--remote" : "--local"}${OFF}`);
    return;
  }

  const applied = new Set(queryRows("SELECT name FROM d1_migrations", remote).map((r) => r.name));
  const pending = [];
  for (const n of names) {
    const done = applied.has(`${n}.sql`);
    console.log(`  ${done ? `${GREEN}✓${OFF}` : `${YELLOW}·${OFF}`} ${n}`);
    if (!done) pending.push(n);
  }

  // Catatan yang tidak punya berkasnya berarti migrasi pernah dijalankan lalu
  // berkasnya hilang dari repo — skema database tidak lagi bisa dibangun ulang
  // dari nol, dan itu harus terlihat.
  const orphan = [...applied].filter((a) => !names.includes(a.replace(/\.sql$/, "")));
  if (orphan.length > 0) {
    console.log(`\n${RED}✘${OFF} Tercatat tapi berkasnya tidak ada: ${orphan.join(", ")}`);
  }

  console.log(
    pending.length === 0
      ? `\n${GREEN}✓${OFF} Semua ${names.length} migrasi sudah diterapkan.`
      : `\n${pending.length} menunggu — jalankan \`apply\`.`,
  );
}

function cmdApply(remote) {
  // Penjaga yang menghindarkan kerusakan nyata: pada database tak terlacak yang
  // sudah berisi tabel, `migrations apply` mulai dari 0000 — CREATE TABLE yang
  // sudah ada, gagal, dan seluruh proses berhenti di migrasi pertama.
  if (!hasTrackingTable(remote) && !isEmptyDatabase(remote)) {
    fail(
      "Database ini sudah berisi tabel tapi belum punya catatan migrasi.\n" +
      "  Menerapkan sekarang akan mengulang dari 0000 dan gagal di tabel yang sudah ada.\n\n" +
      `  Adopsi dulu:  ${GREEN}node scripts/db-migrate.mjs baseline ${remote ? "--remote" : "--local"}${OFF}`,
    );
  }
  wrangler(["d1", "migrations", "apply", BINDING], { remote });
}

function cmdBaseline(remote, write) {
  if (hasTrackingTable(remote)) {
    fail("Database ini sudah punya catatan migrasi — baseline tidak diperlukan. Pakai `apply`.");
  }
  if (isEmptyDatabase(remote)) {
    fail("Database ini kosong — tidak ada yang perlu diadopsi. Langsung `apply`.");
  }

  const names = migrationNames();
  const applied = [];
  let stopped = null;

  // Urutan itu wajib: migrasi hanya bisa dianggap sudah diterapkan kalau semua
  // pendahulunya juga. Tanpa aturan ini, 0004 (yang tandanya sebuah ketiadaan)
  // akan terbaca "sudah" di database yang bahkan belum punya tabel inventory.
  for (const name of names) {
    const spec = FINGERPRINTS[name];
    if (!spec) { stopped = `${name} tidak punya sidik jari`; break; }
    if (queryNumber(probeSql(spec), remote) > 0) { applied.push(name); continue; }
    stopped = `${name} belum ada di skema`;
    break;
  }

  // Migrasi setelah titik berhenti yang ternyata ada tandanya = skema tidak
  // berurutan. Menebak di sini berisiko melewatkan perubahan data seperti
  // rekonsiliasi di 0004, jadi lebih baik berhenti dan minta orang melihatnya.
  const after = names.slice(applied.length + 1);
  const anomali = after.filter((n) => FINGERPRINTS[n] && queryNumber(probeSql(FINGERPRINTS[n]), remote) > 0);
  if (anomali.length > 0) {
    fail(
      `Skema tidak berurutan: ${stopped}, tapi tanda dari ${anomali.join(", ")} justru ada.\n` +
      "  Baseline menolak menebak. Periksa database ini manual.",
    );
  }

  console.log(`\nTerdeteksi sudah diterapkan (${applied.length}/${names.length}):`);
  for (const n of applied) console.log(`  ${GREEN}✓${OFF} ${n}`);
  if (stopped) info(`  berhenti di: ${stopped}`);

  const pending = names.slice(applied.length);
  if (pending.length > 0) {
    console.log(`\nAkan tersisa untuk dijalankan \`apply\` (${pending.length}):`);
    for (const n of pending) console.log(`  ${YELLOW}·${OFF} ${n}`);
  }

  if (!write) {
    console.log(`\n${DIM}Ini baru pemeriksaan. Tambahkan --write untuk menuliskan catatannya.${OFF}`);
    return;
  }

  if (applied.length === 0) {
    fail("Tidak ada satu pun migrasi terdeteksi — tidak ada yang ditulis.");
  }

  // Skema tabel ini milik wrangler; dibuat identik supaya `migrations apply`
  // berikutnya memakainya, bukan membuat versinya sendiri.
  const ddl =
    "CREATE TABLE IF NOT EXISTS d1_migrations(" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, " +
    "applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)";
  const rows = applied.map((n) => `('${n}.sql')`).join(", ");
  try {
    wrangler(
      ["d1", "execute", BINDING, "--json", "--command", `${ddl}; INSERT INTO d1_migrations (name) VALUES ${rows};`],
      { remote, capture: true },
    );
  } catch (err) {
    fail(`Gagal menuliskan catatan migrasi:\n${err.message}`);
  }

  console.log(`\n${GREEN}✓${OFF} ${applied.length} migrasi dicatat sebagai sudah diterapkan.`);
  if (pending.length > 0) {
    console.log(`  Lanjutkan: ${GREEN}node scripts/db-migrate.mjs apply ${remote ? "--remote" : "--local"}${OFF}`);
  }
}

// Dipakai scripts/check-deploy-config.mjs untuk menahan deploy Worker selama
// masih ada migrasi tertunda. Melempar kalau keadaannya tidak bisa dibaca —
// pemanggil yang memutuskan apakah itu alasan membatalkan deploy.
export function pendingMigrations(remote, profileName = "") {
  if (profileName) CURRENT_PROFILE = profileName;
  if (!hasTrackingTable(remote)) {
    if (!isEmptyDatabase(remote)) throw new Error("database belum di-baseline");
    return migrationNames();
  }
  const applied = new Set(queryRows("SELECT name FROM d1_migrations", remote).map((r) => r.name));
  return migrationNames().filter((n) => !applied.has(`${n}.sql`));
}

// ─── Entry ────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv.find((a) => !a.startsWith("--"));
  const remote = argv.includes("--remote");
  const write = argv.includes("--write");

  if (remote && argv.includes("--local")) fail("Pilih salah satu: --local atau --remote.");
  if (!existsSync(MIGRATIONS_DIR)) fail(`Folder migrasi tidak ditemukan: ${MIGRATIONS_DIR}`);

  CURRENT_PROFILE = profileFromArgv(argv);
  const target = remote ? `remote (profil: ${CURRENT_PROFILE || "?"})` : "lokal";
  switch (cmd) {
    case "status":   info(`Database ${target}`); return cmdStatus(remote);
    case "apply":    info(`Database ${target}`); return cmdApply(remote);
    case "baseline": info(`Database ${target}`); return cmdBaseline(remote, write);
  }

  console.log(`
Migrasi D1 — satu jalur, tercatat di tabel d1_migrations.

  node scripts/db-migrate.mjs status   [--local|--remote]   apa yang sudah & belum
  node scripts/db-migrate.mjs apply    [--local|--remote]   jalankan yang belum
  node scripts/db-migrate.mjs baseline [--local|--remote]   adopsi database lama
                                       [--write]            tulis catatannya

Tanpa flag = --local. Lewat pnpm: db:status, db:migrate, db:migrate:remote.

baseline hanya untuk database yang migrasinya pernah dijalankan sebelum repo ini
punya pelacakan. Ia membaca skema untuk menyimpulkan sudah sampai mana, lalu
mencatatnya tanpa menjalankan ulang apa pun. Cukup sekali per database.
`);
  process.exit(cmd ? 1 : 0);
}

// Berkas ini juga di-import sebagai modul oleh check-deploy-config.mjs, jadi
// CLI-nya hanya jalan kalau memang dieksekusi langsung.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    fail(err.message);
  }
}
