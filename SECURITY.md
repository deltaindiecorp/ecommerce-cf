# Kebijakan Keamanan

Project ini menangani data pelanggan (nama, email, no. HP, alamat) dan
terhubung ke payment gateway (Midtrans, Xendit). Kami menganggap serius
laporan kerentanan keamanan.

## Melapor Kerentanan

**Jangan buat GitHub issue publik untuk kerentanan keamanan.**

Laporkan secara privat ke: `info@deltaindie.com`

Sertakan sebisa mungkin:
- Deskripsi kerentanan dan potensi dampaknya
- Langkah reproduksi (endpoint, payload, kondisi yang dibutuhkan)
- Versi/commit yang diuji

Kami akan konfirmasi penerimaan laporan dalam waktu wajar dan menginformasikan
progres perbaikan. Mohon beri waktu untuk perbaikan sebelum mengungkap
kerentanan secara publik (*coordinated disclosure*).

## Lingkup

Termasuk dalam lingkup:
- `apps/api` — Worker API (auth, checkout, payment webhook, dll.)
- `apps/storefront`, `apps/admin` — aplikasi Remix
- `packages/db`, `packages/shared` — schema & validasi yang dipakai di atas
- Konfigurasi deployment (`wrangler.toml`, CI) selama itu bukan soal
  konfigurasi spesifik instance orang lain

Di luar lingkup: kerentanan pada dependency pihak ketiga (Hono, Drizzle,
Remix, dll.) — laporkan ke maintainer proyek tersebut, kecuali cara kami
memakainya yang menimbulkan masalah.

## Yang Sudah Diterapkan

Supaya laporan lebih fokus ke hal yang belum tertangani, berikut proteksi
yang sudah ada di codebase saat ini:

- Password di-hash dengan PBKDF2 (Web Crypto API, 100.000 iterasi)
- JWT ditandatangani HMAC-SHA256, expiry pendek untuk token guest
- Rate limiting berbasis IP/email untuk login, register, OTP, dan bootstrap-admin
  (lihat `apps/api/src/middleware/rate-limit.ts`)
- Validasi upload gambar dari isi file (magic bytes), bukan `Content-Type`
  yang diklaim client (lihat `apps/api/src/lib/image-type.ts`)
- Webhook payment (Midtrans/Xendit) diverifikasi signature/token sebelum diproses
- Reservasi stok atomik lewat Durable Object untuk cegah oversell saat checkout bersamaan
- `bootstrap-admin` dilindungi secret dan otomatis terkunci begitu admin pertama ada

## Catatan untuk yang Deploy Sendiri (Fork/Clone)

Kebijakan ini berlaku untuk kerentanan di **kode template**. Kalau kamu
men-deploy fork/instance sendiri, kesalahan konfigurasi (secret bocor,
`ADMIN_BOOTSTRAP_SECRET` yang tidak dikosongkan lagi, dll.) adalah
tanggung jawab operator masing-masing instance — bukan bug di template ini.
