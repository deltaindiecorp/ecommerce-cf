# Panduan Deploy Klien Baru

Langkah demi langkah dari repo kosong sampai toko klien hidup di domainnya
sendiri. Perkiraan waktu: 30–45 menit untuk klien pertama, ~15 menit untuk
klien berikutnya.

---

## Sebelum mulai: jangan clone per klien

Godaan pertama biasanya "clone repo ini sekali per klien". **Jangan.**

Yang terjadi kalau begitu: tiap clone mulai menyimpang pada berkas yang persis
sama (`wrangler.toml`, nama project Pages, `.env`). Begitu ada perbaikan
keamanan di template, setiap `git pull` ke tiap clone berakhir konflik di
berkas-berkas itu — selamanya, dan makin parah seiring bertambahnya klien.
Menambal sepuluh clone satu per satu adalah cara paling andal untuk punya
sembilan klien yang tertambal dan satu yang terlupakan.

Repo ini memakai **satu working copy untuk semua klien**. Yang membedakan
mereka hanya `deployments/<profil>.env` yang tidak dilacak git:

```
satu clone
├── deployments/meadza.env      → meadza.id
├── deployments/larizq.env      → larizqstore.com
└── deployments/klienc.env      → dst.
```

Nama profil jadi awalan semua nama resource Cloudflare (`meadza-api`,
`meadza-db`, `meadza-notification-queue`), karena dua deployment dalam satu
akun tidak boleh punya nama resource yang sama.

**Kapan clone terpisah memang masuk akal:** kalau klien meminta kode sumbernya
sendiri, atau minta fitur yang menyimpang jauh dari template sehingga tidak
mungkin lagi ikut arus perbaikan. Itu keputusan bisnis, bukan keputusan teknis
— dan sejak saat itu klien tersebut jadi produk terpisah yang harus dirawat
sendiri.

---

## Prasyarat (sekali saja, bukan per klien)

```bash
git clone https://github.com/deltaindiecorp/ecommerce-cf.git
cd ecommerce-cf
pnpm install
npx wrangler login
```

Yang perlu disiapkan per klien sebelum mulai:

| Kebutuhan | Keterangan |
|---|---|
| Domain | mis. `meadza.id`, sudah bisa diatur DNS-nya |
| Akun Midtrans | Server Key + Client Key |
| Akun Xendit | Secret Key + Webhook Token |
| Akun RajaOngkir | API key (lihat catatan di bagian akhir) |
| Akun Binderbyte | API key untuk cek resi |
| Akun Resend | API key + domain pengirim **terverifikasi** |

Domain pengirim yang belum terverifikasi di Resend membuat semua email
transaksional (verifikasi, reset password, notifikasi pesanan) gagal diam-diam.
Verifikasi itu butuh penambahan record DNS, jadi kerjakan lebih awal.

### Akun Cloudflare mana?

Klien boleh menumpang akun agency Anda, atau punya akunnya sendiri — nama
resource sudah diawali nama profil, jadi keduanya sama-sama bisa.

Kalau login wrangler Anda hanya punya akses ke satu akun, tidak ada yang perlu
dipikirkan: `setup.sh` menyematkan ID akunnya ke profil secara otomatis. Kalau
punya akses ke lebih dari satu, ia **berhenti dan meminta Anda menyebutkan yang
mana** — resource produksi yang terlanjur lahir di akun klien lain tidak bisa
dipindah, hanya bisa dibuat ulang.

---

## Fase 1 — Buat profil

```bash
./scripts/setup.sh meadza
```

Jalan pertama ini **belum menyentuh Cloudflare sama sekali**. Ia hanya membuat
kerangka `deployments/meadza.env` lalu berhenti, karena lima nilai berikut
sengaja tidak ditebak:

```bash
STORE_URL=https://meadza.id
ADMIN_URL=https://admin.meadza.id
API_BASE=https://api.meadza.id
EMAIL_FROM_NAME=Meadza
EMAIL_FROM_ADDRESS=noreply@meadza.id
```

Kelimanya masuk ke konfigurasi CORS dan ke tautan di dalam email. Salah isi
tidak bikin apa pun gagal saat deploy — ia baru ketahuan saat storefront
produksi ditolak API-nya sendiri.

> **Belum punya domain untuk API?** Isi `API_BASE` sementara dengan apa saja,
> lalu ikuti "Fase 4 alternatif" di bawah. Nilai ini dibakar ke dalam build
> storefront dan admin, jadi harus benar sebelum keduanya di-deploy.

---

## Fase 2 — Provisioning Cloudflare

```bash
./scripts/setup.sh meadza
```

Jalan kedua memastikan dulu akun Cloudflare mana yang dipakai (lihat catatan di
Prasyarat), lalu membuat: 1 D1 database, 3 KV namespace, 1 R2 bucket, 2 Queue —
semuanya berawalan `meadza-`. ID hasilnya ditulis balik ke
`deployments/meadza.env`, config deploy dirender ke
`apps/api/wrangler.meadza.generated.toml`, lalu migrasi database dijalankan.

Sejak titik ini, `CLOUDFLARE_ACCOUNT_ID` tersemat di profil dan **setiap**
perintah wrangler berikutnya menyasar akun itu — bukan akun yang kebetulan
sedang aktif. Itu yang membuat klien berakun sendiri dan klien yang menumpang
akun agency bisa dikelola dari mesin yang sama.

Script ini **aman dijalankan ulang**. Resource yang sudah ada dicari ID-nya,
bukan bikin script berhenti — penting karena provisioning bisa gagal di tengah
(misalnya koneksi putus setelah D1 jadi tapi sebelum queue dibuat).

---

## Fase 3 — Secret

```bash
pnpm secrets scaffold --profile meadza
```

Membuat `deployments/meadza.secrets.env` (izin 0600, tidak dilacak git). Isi
kedelapan nilainya:

```bash
JWT_SECRET=              # acak & panjang: openssl rand -base64 48
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
XENDIT_SECRET_KEY=
XENDIT_WEBHOOK_TOKEN=
RAJAONGKIR_API_KEY=
BINDERBYTE_API_KEY=
RESEND_API_KEY=
```

Lalu unggah sekaligus:

```bash
pnpm secrets push --profile meadza
```

Perintahnya menolak jalan kalau masih ada yang kosong. Itu disengaja:
`JWT_SECRET` kosong membuat `crypto.subtle.importKey` melempar `DataError` dan
seluruh autentikasi mati — kegagalan yang baru terasa saat orang pertama
mencoba login.

Aktifkan juga `ADMIN_BOOTSTRAP_SECRET` (barisnya masih dikomentari di berkas
itu) — dibutuhkan sekali di Fase 5, lalu dihapus lagi.

---

## Fase 4 — Deploy

```bash
pnpm run deploy:client meadza
```

Urutannya dijaga: migrasi D1 diperiksa → Worker API → build & deploy storefront
→ build & deploy admin. Deploy dibatalkan kalau masih ada migrasi tertunda.

### Fase 4 alternatif — kalau API belum punya domain sendiri

`API_BASE` dibakar ke dalam build storefront dan admin, tapi URL `workers.dev`
baru diketahui setelah Worker-nya pernah naik. Jadi:

```bash
# 1. Worker dulu
pnpm run deploy:client meadza --only=api
#    catat URL yang dicetak, mis. https://meadza-api.deltaindie.workers.dev

# 2. Perbarui API_BASE di deployments/meadza.env dengan URL itu

# 3. Baru Pages
pnpm run deploy:client meadza
```

---

## Fase 5 — Admin pertama

```bash
curl -X POST https://api.meadza.id/api/auth/bootstrap-admin \
  -H "Content-Type: application/json" \
  -H "X-Bootstrap-Secret: <isi ADMIN_BOOTSTRAP_SECRET>" \
  -d '{
    "name": "Admin Meadza",
    "email": "admin@meadza.id",
    "phone": "08123456789",
    "password": "password-minimal-8-karakter"
  }'
```

Ketentuan yang divalidasi: `name` minimal 2 karakter, `phone` format Indonesia
(`08…`, `62…`, atau `+62…`), `password` minimal 8 karakter. Endpoint ini
dibatasi 5 percobaan per jam.

Endpoint ini **mengunci dirinya sendiri** begitu ada satu user berrole admin —
percobaan berikutnya dijawab 409. Admin selanjutnya ditambahkan lewat panel.

Setelah berhasil, **hapus secret bootstrap-nya**:

```bash
cd apps/api
npx wrangler secret delete ADMIN_BOOTSTRAP_SECRET --config wrangler.meadza.generated.toml
cd ../..
```

Kosongkan juga barisnya di `deployments/meadza.secrets.env` supaya tidak ikut
terunggah lagi pada `secrets push` berikutnya.

---

## Fase 6 — Domain kustom

Di Cloudflare Dashboard:

| Komponen | Lokasi | Domain |
|---|---|---|
| Worker API | Workers & Pages → `meadza-api` → Settings → Domains & Routes | `api.meadza.id` |
| Storefront | Workers & Pages → `meadza-storefront` → Custom domains | `meadza.id` |
| Admin | Workers & Pages → `meadza-admin` → Custom domains | `admin.meadza.id` |

Kalau domainnya sudah berada di akun Cloudflare yang sama, record DNS dibuat
otomatis. Kalau tidak, ikuti instruksi CNAME yang ditampilkan.

**Kalau domain berubah setelah ini**, `CORS_ORIGINS` di config sudah terlanjur
dirender dari nilai lama. Perbarui `deployments/meadza.env`, lalu:

```bash
node scripts/gen-wrangler.mjs --profile meadza
pnpm run deploy:client meadza
```

---

## Fase 7 — Webhook gateway

Daftarkan di dashboard masing-masing provider:

| Provider | URL |
|---|---|
| Midtrans (Payment Notification) | `https://api.meadza.id/api/payment/webhook/midtrans` |
| Xendit (Callback URL) | `https://api.meadza.id/api/payment/webhook/xendit` |

Tanpa ini pembayaran yang berhasil tidak akan pernah tercatat lunas — pembeli
membayar, sistem tetap menganggapnya pending, dan stok terkunci sampai
kedaluwarsa.

Untuk Midtrans, `MIDTRANS_IS_PROD=false` di `deployments/meadza.env`
mengarahkan ke sandbox selama pengujian. Xendit tidak punya saklar itu — ia
dibedakan lewat kunci API-nya (test vs live).

---

## Fase 8 — Verifikasi sebelum diserahkan

```bash
curl https://api.meadza.id/                     # {"status":"ok",...}
pnpm db:status:remote -- --profile meadza       # semua migrasi tercentang
pnpm secrets list --profile meadza              # 8 secret, tanpa ADMIN_BOOTSTRAP_SECRET
```

Lalu manual, dan ini yang paling penting — **lakukan satu transaksi sungguhan
bernominal kecil**:

1. Buka storefront, tambah produk ke keranjang
2. Checkout sampai halaman pembayaran, pastikan ongkir muncul dan masuk akal
3. Bayar betulan
4. Pastikan status pesanan berubah jadi lunas **tanpa disentuh manual** — ini
   yang membuktikan webhook-nya sampai
5. Cek email notifikasi masuk
6. Login panel admin, pastikan pesanan dan stoknya benar
7. Coba refund pesanan itu

Ganti nama toko lewat panel admin (Pengaturan) — placeholder bawaannya
"Deltacommerce", dan itu akan muncul di judul halaman serta email kalau tidak
diganti.

---

## Klien kedua dan seterusnya

Ulangi Fase 1–8 dengan nama profil lain. Tidak ada berkas ter-track yang perlu
disentuh:

```bash
./scripts/setup.sh larizq
# isi deployments/larizq.env
./scripts/setup.sh larizq
pnpm secrets scaffold --profile larizq
pnpm secrets push --profile larizq
pnpm run deploy:client larizq
```

```bash
pnpm run profiles          # lihat semua profil yang ada
```

---

## Merawat: merilis perbaikan ke semua klien

Setelah perbaikan masuk ke template, pekerjaannya bukan lagi "deploy", tapi
"deploy yang sama ke semua klien tanpa ada yang terlewat" — dan yang terlewat
tidak kelihatan, klien itu hanya tetap berjalan di versi lama sampai ada yang
mengeluh.

```bash
git pull
pnpm install
pnpm rollout --dry-run     # lihat rencananya dulu
pnpm rollout               # semua profil, berurutan
```

Semua profil diperiksa lebih dulu; kalau ada satu yang belum siap, tidak ada
satu pun yang di-deploy. Config tiap profil dirender ulang dari template
terbaru, migrasi dijalankan sebelum Worker-nya naik, dan kegagalan menghentikan
sisanya (`--keep-going` untuk memaksa lanjut).

```bash
pnpm rollout --profiles=meadza,larizq   # sebagian saja
pnpm rollout --only=admin               # bagian tertentu saja
```

### Kalau perbaikannya mengubah skema database

`pnpm db:generate` di mesin Anda, commit SQL-nya, lalu `pnpm rollout` —
migrasinya ikut jalan per klien sebelum Worker-nya naik.

---

## Yang WAJIB dicadangkan

Dua berkas per klien, keduanya tidak ada di git:

| Berkas | Isi | Kalau hilang |
|---|---|---|
| `deployments/<profil>.env` | domain, ID akun, dan ID resource Cloudflare | harus dicari lagi satu per satu lewat dashboard |
| `deployments/<profil>.secrets.env` | API key semua provider | harus di-generate ulang di tiap provider |

Yang kedua berisi rahasia — simpan di password manager, bukan di folder yang
ikut ter-backup ke mana-mana.

---

## Kalau ada yang tidak beres

**"Profil tidak lengkap"** — ada nilai wajib yang masih kosong di
`deployments/<profil>.env`.

**"Login ini punya akses ke N akun Cloudflare"** — `setup.sh` menolak menebak.
Pilih salah satu ID yang ditampilkan, isikan sebagai `CLOUDFLARE_ACCOUNT_ID` di
`deployments/<profil>.env`, lalu jalankan lagi.

**"Punya tabel tapi tidak punya catatan migrasi"** — database itu pernah
dimigrasi di luar jalur resmi. Jalankan `pnpm db:baseline:remote -- --profile
<nama>` untuk melihat kesimpulannya, lalu ulangi dengan `--write`.

**"apps/api/wrangler.toml sudah berubah sejak … dirender"** — template berubah
setelah config klien ini dirender. Jalankan `node scripts/gen-wrangler.mjs
--profile <nama>`, atau langsung `pnpm rollout` yang sudah merender ulang
sendiri.

**"Ada N migrasi yang belum diterapkan"** — deploy sengaja ditahan. Migrasi
`0004` menyalin `qty_available` ke `qty_on_hand` sebelum menjatuhkan kolom
lamanya; kalau Worker baru naik duluan, angka-angka itu ditimpa data basi tanpa
error apa pun. Jalankan migrasinya dulu.

**Storefront menampilkan "Layanan sedang tidak tersedia"** — API tidak
terjangkau atau membalas 5xx. Pesannya sengaja dibuat buram karena ikut
ter-serialize ke sumber halaman yang dilihat semua pengunjung; detail
teknisnya ada di log Worker (`npx wrangler tail --config
wrangler.<profil>.generated.toml`).

**Checkout gagal menghitung ongkir** — `RAJAONGKIR_API_KEY` kosong atau
ditolak. Kode ini memakai `api.rajaongkir.com/starter` (hanya jne/pos/tiki,
level kota). RajaOngkir sudah bermigrasi ke Komerce, jadi **pastikan endpoint
ini masih dilayani akun Anda sebelum menjanjikan tanggal live ke klien.**

---

## Batas yang perlu diketahui

Per dokumen ini ditulis, **belum ada satu pun deployment sungguhan** dari repo
ini. Semua verifikasi berjalan di Miniflare lokal. Langkah-langkah di atas
mengikuti apa yang benar-benar dilakukan script, tapi klien pertama tetap akan
jadi yang pertama menemukan gesekan di dunia nyata — sisihkan waktu lebih untuk
itu, dan jangan janjikan tanggal live yang mepet.
