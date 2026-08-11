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

## Waktu Tanggap

Menyebut "waktu wajar" tanpa angka membuat pelapor tidak punya dasar untuk
memutuskan kapan boleh mengungkap. Target kami:

| Tahap | Target |
|---|---|
| Konfirmasi laporan diterima | 3 hari kerja |
| Penilaian awal & tingkat keparahan | 7 hari kerja |
| Perbaikan untuk kerentanan berat | 30 hari |
| Perbaikan untuk kerentanan ringan/sedang | 90 hari |

Kalau kami melewati target tanpa kabar, silakan anggap embargo berakhir dan
kamu bebas mengungkapkannya. Kami akan mencantumkan kredit pelapor kecuali
diminta anonim.

## Urutan Rilis Perbaikan Keamanan

Repo ini publik, jadi **commit perbaikan keamanan sekaligus mengumumkan
kerentanannya** — pesan commit dan diff-nya menjelaskan persis apa yang dulu
rusak dan bagaimana memicunya.

Karena itu perbaikan keamanan mengikuti urutan ini, bukan sebaliknya:

1. Perbaiki di branch privat
2. Deploy ke seluruh instance yang kami kelola
3. Baru push ke repo publik, dengan penjelasan lengkap

Konsekuensinya untuk siapa pun yang men-deploy instance sendiri: **selisih
versi adalah risiko keamanan aktif.** Begitu perbaikan muncul di repo publik,
detail kerentanannya ikut terbuka — instance yang tertinggal versi jadi sangat
mudah diserang karena penyerang tidak perlu menebak apa pun. Pantau rilis dan
perbarui secepatnya.

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

**Autentikasi & sesi**

- Password di-hash dengan PBKDF2 (Web Crypto API, 100.000 iterasi)
- JWT ditandatangani HMAC-SHA256; umur token mengikuti peran — 12 jam untuk
  admin/staff, 2 jam untuk token guest
- Token bisa dicabut per sesi: setiap token punya `jti`, dan logout menyimpannya
  di daftar cabut KV sampai token itu kedaluwarsa
- Cookie sesi panel: `HttpOnly`, `Secure`, `SameSite=Lax`
- Rate limiting berbasis IP/email untuk login, register, OTP, dan bootstrap-admin
  (lihat `apps/api/src/middleware/rate-limit.ts`)
- `bootstrap-admin` dilindungi secret dan otomatis terkunci begitu admin pertama ada

**Otorisasi**

- Dua tingkat wewenang: `requireStaff` untuk operasi harian, `requireAdmin` untuk
  tindakan sulit dibatalkan — refund, penghapusan, CRUD gudang, dan voucher
- Transisi status order dibatasi state machine; `refunded` tidak bisa diset lewat
  PATCH sehingga refund selalu melewati gateway pembayaran
- Jejak audit aksi admin (`admin_audit_log`) mencatat aktor, target, dan konteks

**Kebocoran data**

- Endpoint katalog publik memakai proyeksi kolom eksplisit; harga modal
  (`cost_price`) tidak pernah keluar ke storefront, dan hash password tidak
  pernah ikut dalam relasi user pada API admin. Keduanya dikunci test
- Export CSV menetralkan sel berawalan `=`, `+`, `-`, `@` untuk mencegah eksekusi
  formula di spreadsheet (nama pembeli berasal dari input guest yang tidak
  terautentikasi)

**Integritas data & konfigurasi**

- Validasi upload gambar dari isi file (magic bytes), bukan `Content-Type`
  yang diklaim client (lihat `apps/api/src/lib/image-type.ts`)
- Webhook payment (Midtrans/Xendit) diverifikasi signature/token sebelum diproses
- Reservasi stok atomik lewat Durable Object untuk cegah oversell saat checkout bersamaan
- Operasi stok idempoten lewat ledger `inventory_movements`
- Request `/api/*` ditolak dengan pesan jelas kalau `JWT_SECRET` belum diset,
  alih-alih gagal samar di tengah proses

## Catatan untuk yang Deploy Sendiri (Fork/Clone)

Kebijakan ini berlaku untuk kerentanan di **kode template**. Kalau kamu
men-deploy fork/instance sendiri, kesalahan konfigurasi (secret bocor,
`ADMIN_BOOTSTRAP_SECRET` yang tidak dikosongkan lagi, dll.) adalah
tanggung jawab operator masing-masing instance — bukan bug di template ini.
