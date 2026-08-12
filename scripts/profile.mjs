// ─── Profil deployment ────────────────────────────────────────────────────────
// Satu profil = satu klien. Semua yang khas klien (nama resource, domain,
// identitas email, ID hasil provisioning) tinggal di deployments/<profil>.env
// yang TIDAK dilacak git.
//
// Aturannya satu: nol berkas ter-track yang perlu diedit per klien. Kalau
// menambah klien mengharuskan mengubah berkas yang di-commit, dua klien akan
// berebut berkas yang sama dan setiap `git pull` dari template berakhir konflik.
//
// Nama resource wajib berbeda antar klien karena hidup dalam satu akun
// Cloudflare — dua deployment tidak bisa sama-sama punya queue bernama
// "notification-queue". Karena itu hampir semuanya diturunkan dari nama profil,
// dan yang perlu beda tinggal ditimpa satu baris.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEPLOYMENTS_DIR = join(ROOT, "deployments");
export const API_DIR = join(ROOT, "apps", "api");

// Nama profil ikut masuk ke nama resource Cloudflare, jadi dibatasi ke bentuk
// yang aman untuk itu sekaligus untuk nama berkas.
const NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;

export function profilePath(name) {
  return join(DEPLOYMENTS_DIR, `${name}.env`);
}

export function generatedTomlPath(name) {
  return join(API_DIR, `wrangler.${name}.generated.toml`);
}

export function listProfiles() {
  if (!existsSync(DEPLOYMENTS_DIR)) return [];
  return readdirSync(DEPLOYMENTS_DIR)
    .filter((f) => f.endsWith(".env") && f !== "example.env")
    .map((f) => f.replace(/\.env$/, ""))
    // Berkas pendamping seperti meadza.secrets.env juga berakhiran .env, dan
    // tanpa saringan ini ia ikut terbaca sebagai profil bernama "meadza.secrets"
    // — yang lalu muncul di daftar dan ikut kena rollout.
    .filter((n) => NAME_RE.test(n))
    .sort();
}

// Format sengaja dibuat KEY=value polos supaya berkas yang sama bisa dibaca
// script bash (`set -a; . berkas`) dan Node tanpa dependency parser apa pun.
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const REQUIRED = ["STORE_URL", "ADMIN_URL", "API_BASE", "EMAIL_FROM_NAME", "EMAIL_FROM_ADDRESS"];

export function loadProfile(name) {
  if (!name) {
    const tersedia = listProfiles();
    throw new Error(
      "Profil deployment belum ditentukan.\n" +
      "  Pakai --profile <nama>, atau set DEPLOY_PROFILE.\n" +
      (tersedia.length
        ? `  Tersedia: ${tersedia.join(", ")}`
        : "  Belum ada satu pun. Buat lewat: ./scripts/setup.sh <nama>"),
    );
  }
  if (!NAME_RE.test(name)) {
    throw new Error(
      `Nama profil "${name}" tidak valid.\n` +
      "  Harus huruf kecil, angka, dan tanda hubung; diawali huruf; maksimal 31 karakter.\n" +
      "  Nama ini ikut jadi nama resource Cloudflare, jadi bentuknya dibatasi.",
    );
  }

  const path = profilePath(name);
  if (!existsSync(path)) {
    throw new Error(
      `Profil "${name}" tidak ada (${path.replace(ROOT + "/", "")}).\n` +
      "  Buat lewat: ./scripts/setup.sh " + name,
    );
  }

  const raw = parseEnvFile(readFileSync(path, "utf8"));
  return resolveProfile(name, raw);
}

// Diekspor terpisah dari pembacaan berkas supaya penurunan nilainya bisa diuji
// tanpa menyentuh filesystem.
export function resolveProfile(name, raw) {
  const p = { ...raw, PROFILE: name };

  // Diturunkan dari nama profil kecuali ditimpa. Prefiks profil itu yang
  // membuat dua klien bisa hidup berdampingan di satu akun Cloudflare.
  p.WORKER_NAME      ??= `${name}-api`;
  p.D1_NAME          ??= `${name}-db`;
  p.R2_BUCKET        ??= `${name}-storage`;
  p.QUEUE_NOTIFICATION ??= `${name}-notification-queue`;
  p.QUEUE_RESI       ??= `${name}-resi-poll-queue`;
  p.PAGES_STOREFRONT ??= `${name}-storefront`;
  p.PAGES_ADMIN      ??= `${name}-admin`;

  const kurang = REQUIRED.filter((k) => !p[k]);
  if (kurang.length) {
    throw new Error(
      `Profil "${name}" belum lengkap — belum diisi: ${kurang.join(", ")}\n` +
      `  Lengkapi di deployments/${name}.env`,
    );
  }

  p.APP_URL ??= p.STORE_URL;
  // Browser mengirim Origin tanpa slash penutup; satu slash nyasar di sini
  // membuat CORS menolak diam-diam dan storefront gagal tanpa pesan berguna.
  p.CORS_ORIGINS ??= [p.STORE_URL, p.ADMIN_URL].map((u) => u.replace(/\/+$/, "")).join(",");
  p.MIDTRANS_IS_PROD ??= "true";

  return p;
}

// ID resource baru ada setelah provisioning, jadi perintah yang butuh config
// deploy siap-pakai memeriksanya terpisah dari kelengkapan profil.
export const RESOURCE_IDS = ["D1_DATABASE_ID", "CART_KV_ID", "SESSION_KV_ID", "CACHE_KV_ID"];

export function missingResourceIds(profile) {
  return RESOURCE_IDS.filter((k) => !profile[k]);
}

// Dipakai semua CLI di scripts/ supaya cara menyebut profil seragam.
export function profileFromArgv(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--profile");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith("--profile="));
  if (inline) return inline.slice("--profile=".length);
  return process.env.DEPLOY_PROFILE || "";
}

// Menyetel nilai di berkas profil tanpa mengganggu komentar dan urutan yang ada —
// berkas ini juga dibaca manusia, dan setup.sh menulis ke sana setelah
// provisioning.
export function setProfileValues(name, values) {
  const path = profilePath(name);
  const lines = readFileSync(path, "utf8").split("\n");
  const sisa = new Map(Object.entries(values));

  const hasil = lines.map((line) => {
    const key = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (!key || !sisa.has(key)) return line;
    const val = sisa.get(key);
    sisa.delete(key);
    return `${key}=${val}`;
  });

  for (const [key, val] of sisa) hasil.push(`${key}=${val}`);
  writeFileSync(path, hasil.join("\n"));
}

// Membuat kerangka profil dari example.env. Nilai wajibnya sengaja TIDAK diisi
// tebakan — domain salah yang lolos diam-diam jauh lebih mahal daripada satu
// langkah manual, karena ia baru ketahuan saat CORS menolak di produksi.
export function scaffoldProfile(name) {
  const contoh = join(DEPLOYMENTS_DIR, "example.env");
  if (!existsSync(contoh)) throw new Error(`Tidak ketemu ${contoh}`);
  if (!existsSync(DEPLOYMENTS_DIR)) throw new Error(`Tidak ketemu ${DEPLOYMENTS_DIR}`);

  const isi = readFileSync(contoh, "utf8")
    .replace(/^(STORE_URL|ADMIN_URL|API_BASE|EMAIL_FROM_NAME|EMAIL_FROM_ADDRESS)=.*$/gm, "$1=")
    .replace(/meadza/g, name);

  writeFileSync(profilePath(name), isi);
  return profilePath(name);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
// Supaya scripts/setup.sh (bash) tidak perlu menduplikasi aturan penurunan nama
// di atas — satu-satunya definisinya tetap di berkas ini.

function cli() {
  const [cmd, name, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "print": {
        // Dipakai lewat `eval "$(node scripts/profile.mjs print <nama>)"`.
        const p = loadProfile(name);
        for (const [k, v] of Object.entries(p)) {
          if (typeof v === "string") console.log(`${k}=${JSON.stringify(v)}`);
        }
        break;
      }
      case "set":
        setProfileValues(name, Object.fromEntries(rest.map((kv) => {
          const i = kv.indexOf("=");
          return [kv.slice(0, i), kv.slice(i + 1)];
        })));
        break;
      case "scaffold":
        console.log(scaffoldProfile(name));
        break;
      case "list":
        for (const n of listProfiles()) console.log(n);
        break;
      default:
        console.error("Perintah: print <nama> | set <nama> KEY=VAL… | scaffold <nama> | list");
        process.exit(1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
