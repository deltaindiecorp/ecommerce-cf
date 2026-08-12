#!/usr/bin/env node
// Merender apps/api/wrangler.<profil>.generated.toml dari template
// apps/api/wrangler.toml + deployments/<profil>.env.
//
// Menulis ulang baris berdasarkan KUNCI, bukan mengganti token `__PLACEHOLDER__`.
// Alasannya: template harus tetap berupa konfigurasi yang sah dan masuk akal
// untuk `wrangler dev` lokal. Kalau isinya penuh placeholder, dev lokal ikut
// rusak demi kerapian deploy.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_DIR, ROOT, loadProfile, profileFromArgv, generatedTomlPath, missingResourceIds,
} from "./profile.mjs";

const TEMPLATE = join(API_DIR, "wrangler.toml");

// ─── Sidik jari template ──────────────────────────────────────────────────────
// Ditulis ke header hasil render supaya penjaga deploy bisa menjawab pertanyaan
// yang sebenarnya: "config ini dirender dari template yang MANA?".
//
// Sebelumnya pertanyaannya dijawab dengan membandingkan mtime, yang menjawab hal
// lain: berkas mana yang lebih baru. Dua-duanya meleset. `git checkout` menyegarkan
// mtime wrangler.toml walau isinya sama persis, sehingga penjaga menolak deploy
// tanpa ada yang benar-benar berubah — dan pada repo yang dipakai banyak klien itu
// terjadi setiap kali menarik perbaikan, untuk setiap profil.
export const STAMP = "template-sha256";

export function templateHash(text) {
  return createHash("sha256").update(text ?? readFileSync(TEMPLATE, "utf8")).digest("hex");
}

// null = berkasnya dari versi sebelum stempel ada; itu dibedakan dari "tidak cocok"
// supaya pesannya bisa menyebut sebab yang tepat.
export function readStamp(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").match(new RegExp(`^#\\s*${STAMP}:\\s*([0-9a-f]{64})`, "m"))?.[1] ?? null;
}

// Nilai TOML ditulis sebagai string kutip ganda; yang perlu dijaga hanya
// backslash dan kutip. Nilai profil di sini berupa nama resource dan URL.
const q = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function renderConfig(templateText, p) {
  const lines = templateText.split("\n");
  const out = [];

  // KV dibedakan lewat binding di baris sebelumnya — di TOML `id` sendirian
  // tidak memberi tahu namespace mana yang dimaksud.
  const kvIdByBinding = {
    CART_KV: p.CART_KV_ID, SESSION_KV: p.SESSION_KV_ID, CACHE_KV: p.CACHE_KV_ID,
  };
  let kvBinding = null;
  let diVars = false;
  let diTopLevel = true; // sebelum tabel pertama

  const varsOverrides = {
    APP_URL:            p.APP_URL,
    CORS_ORIGINS:       p.CORS_ORIGINS,
    EMAIL_FROM_NAME:    p.EMAIL_FROM_NAME,
    EMAIL_FROM_ADDRESS: p.EMAIL_FROM_ADDRESS,
    MIDTRANS_IS_PROD:   p.MIDTRANS_IS_PROD,
  };

  const setKey = (line, key, value) => {
    const pad = line.match(new RegExp(`^${key}(\\s*)=`));
    return `${key}${pad ? pad[1] : " "}= ${q(value)}`;
  };

  for (const line of lines) {
    const t = line.trim();

    if (t.startsWith("[")) {
      diVars = t === "[vars]";
      diTopLevel = false;
      if (t !== "[[kv_namespaces]]") kvBinding = null;
      out.push(line);
      continue;
    }

    const key = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (!key) { out.push(line); continue; }

    if (key === "binding") {
      kvBinding = t.match(/=\s*"([^"]+)"/)?.[1] ?? null;
      out.push(line);
      continue;
    }

    // `name` di top-level adalah nama Worker. `name` di dalam
    // [[durable_objects.bindings]] adalah nama binding dan TIDAK boleh diubah —
    // kode di apps/api merujuk binding itu lewat nama tersebut.
    if (key === "name" && diTopLevel)      { out.push(setKey(line, "name", p.WORKER_NAME)); continue; }
    if (key === "database_name")           { out.push(setKey(line, "database_name", p.D1_NAME)); continue; }
    if (key === "database_id")             { out.push(setKey(line, "database_id", p.D1_DATABASE_ID ?? "")); continue; }
    if (key === "bucket_name")             { out.push(setKey(line, "bucket_name", p.R2_BUCKET)); continue; }

    if (key === "id" && kvBinding && kvBinding in kvIdByBinding) {
      out.push(setKey(line, "id", kvIdByBinding[kvBinding] ?? ""));
      continue;
    }

    // Queue muncul di producers DAN consumers; keduanya harus ikut berganti,
    // kalau tidak Worker memproduksi ke satu antrean dan menyimak antrean lain.
    if (key === "queue") {
      const asal = t.match(/=\s*"([^"]+)"/)?.[1];
      const baru = asal === "notification-queue" ? p.QUEUE_NOTIFICATION
                 : asal === "resi-poll-queue"    ? p.QUEUE_RESI
                 : null;
      out.push(baru ? setKey(line, "queue", baru) : line);
      continue;
    }

    if (diVars && key in varsOverrides) {
      // Komentar di ujung baris ikut dibuang bersama nilainya — isinya menjelaskan
      // template, bukan deployment ini.
      out.push(setKey(line, key, varsOverrides[key]));
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

export function generate(name) {
  const p = loadProfile(name);
  if (!existsSync(TEMPLATE)) throw new Error(`Template tidak ada: ${TEMPLATE}`);

  const templateText = readFileSync(TEMPLATE, "utf8");
  const header = [
    `# DIHASILKAN OLEH scripts/gen-wrangler.mjs untuk profil "${name}" — JANGAN di-commit.`,
    "# Berisi ID resource Cloudflare milik deployment ini.",
    `# Sumber: apps/api/wrangler.toml + deployments/${name}.env`,
    "# Jalankan ulang kalau salah satunya berubah:",
    `#   node scripts/gen-wrangler.mjs --profile ${name}`,
    `#`,
    `# ${STAMP}: ${templateHash(templateText)}`,
    `# Dihasilkan: ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
    "",
  ].join("\n");

  const body = renderConfig(templateText, p);
  const target = generatedTomlPath(name);
  writeFileSync(target, header + body);
  return { target, profile: p, missing: missingResourceIds(p) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const name = profileFromArgv();
    const { target, missing } = generate(name);
    console.log(`✓ ${target.replace(ROOT + "/", "")}`);
    if (missing.length) {
      console.warn(`⚠ ID resource belum terisi: ${missing.join(", ")}`);
      console.warn("  Config ini belum bisa dipakai deploy — jalankan ./scripts/setup.sh dulu.");
      process.exit(1);
    }
  } catch (err) {
    console.error(`\x1b[31m✘\x1b[0m ${err.message}`);
    process.exit(1);
  }
}
