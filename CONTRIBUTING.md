# Contributing

Terima kasih sudah tertarik berkontribusi. Repo ini adalah monorepo Turborepo
(pnpm workspaces) — API Hono di Cloudflare Workers, storefront & admin Remix
di Cloudflare Pages.

## Setup

```bash
pnpm install
```

Untuk menjalankan dev server lokal (tanpa perlu resource Cloudflare asli),
lihat bagian "Quick Start" di [README.md](README.md).

## Alur Kerja

1. Fork & buat branch dari `main`
2. Kerjakan perubahan
3. Sebelum membuat PR, pastikan tiga perintah ini lolos semua:
   ```bash
   pnpm type-check
   pnpm test
   pnpm build
   ```
   CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) menjalankan hal
   yang sama otomatis di setiap PR — kalau lolos di lokal, biasanya lolos di CI.
4. Buka PR dengan deskripsi yang jelas: apa yang berubah dan kenapa

## Konvensi

- **Bahasa**: kode & komentar dalam Bahasa Indonesia (mengikuti konvensi yang
  sudah ada di codebase), komentar hanya untuk hal yang non-obvious (alasan
  di balik keputusan desain, bukan menjelaskan ulang apa yang sudah jelas
  dari kode)
- **Belum ada linter/formatter otomatis (ESLint/Prettier config)** — ikuti
  gaya kode yang sudah ada di file sekitar (alignment kolom, spasi, dll.)
- **Test**: taruh di sebelah file yang diuji (`foo.ts` → `foo.test.ts`),
  fokus ke logic murni (validator, kalkulasi, dll.) — bukan route handler
  yang butuh mock D1/KV/Durable Object
- **Migration DB**: kalau mengubah schema di `packages/db/src/schema/`,
  jalankan `cd packages/db && pnpm db:generate` untuk generate migration SQL
  baru, commit hasilnya juga

## Struktur Monorepo

Lihat bagian "Struktur" di [README.md](README.md) untuk peta lengkap
`apps/` dan `packages/`.

## Melaporkan Bug vs Kerentanan Keamanan

- Bug biasa → GitHub Issues
- Kerentanan keamanan → **jangan** lewat issue publik, lihat [SECURITY.md](SECURITY.md)

## Lisensi

Dengan berkontribusi, kamu setuju kontribusimu dilisensikan di bawah
[Apache License 2.0](LICENSE) yang sama dengan project ini.
