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
  jalankan `pnpm db:generate` untuk generate migration SQL baru, commit
  hasilnya juga, lalu `pnpm db:migrate` untuk menerapkannya ke D1 lokal.
  Jangan menjalankan `wrangler d1 execute --file` langsung — migrasi dilacak
  di tabel `d1_migrations`, dan menerapkan di luar jalur itu membuat
  catatannya tidak lagi cocok dengan isi database. Lihat bagian "Migrasi
  Database" di [README.md](README.md).
- **Jangan mengubah migration yang sudah di-commit** — ia mungkin sudah jalan
  di database orang lain, dan pelacakan hanya menyimpan namanya, bukan isinya.
  Perubahan berikutnya masuk sebagai migration baru.

## Struktur Monorepo

Lihat bagian "Struktur" di [README.md](README.md) untuk peta lengkap
`apps/` dan `packages/`.

## Melaporkan Bug vs Kerentanan Keamanan

- Bug biasa → GitHub Issues
- Kerentanan keamanan → **jangan** lewat issue publik, lihat [SECURITY.md](SECURITY.md)

## Lisensi & Sign-off

### Developer Certificate of Origin

Setiap commit wajib di-*sign off*. Tambahkan flag `-s` saat commit:

```bash
git commit -s -m "Pesan commit"
```

Itu menambahkan satu baris di akhir pesan commit:

```
Signed-off-by: Nama Kamu <email@kamu.com>
```

Baris tersebut berarti kamu menyatakan hal-hal dalam
[Developer Certificate of Origin 1.1](https://developercertificate.org/) —
ringkasnya: kamu punya hak untuk menyumbangkan kode itu, dan kode itu bukan
milik orang lain yang lisensinya tidak kompatibel.

DCO **bukan** CLA. Ia hanya soal asal-usul kode: melindungi project dari
kontribusi yang ternyata bukan hak penyumbangnya. Hak cipta atas kontribusimu
tetap milikmu.

### Hak Lisensi

Dengan berkontribusi, kamu:

1. Melisensikan kontribusimu di bawah [Apache License 2.0](LICENSE) yang sama
   dengan project ini; dan
2. Memberi Delta Indie hak non-eksklusif, permanen, dan bebas royalti untuk
   memakai, memodifikasi, dan mendistribusikan ulang kontribusimu — termasuk
   sebagai bagian dari rilis di bawah lisensi lain di kemudian hari.

Poin 2 diperlukan supaya project ini tetap punya opsi mengubah lisensi tanpa
harus melacak ulang setiap kontributor. Kalau kamu tidak setuju dengan poin
tersebut, silakan buka issue lebih dulu — jangan kirim PR-nya.
