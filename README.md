# E-Commerce Cloudflare Workers

Full-stack e-commerce platform yang berjalan sepenuhnya di **Cloudflare Workers + Pages**.
Guest checkout, multi-warehouse, Midtrans + Xendit, cek resi terintegrasi.

## Stack

| Layer | Tech |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| API | Cloudflare Workers + Hono |
| Frontend | Remix (Cloudflare Pages) |
| Database | Cloudflare D1 (SQLite edge) |
| Cache/Session | Cloudflare KV |
| Storage | Cloudflare R2 |
| Queue | Cloudflare Queues |
| State | Cloudflare Durable Objects |
| ORM | Drizzle ORM |
| Payment | Midtrans + Xendit |
| Ongkir | RajaOngkir |
| Cek Resi | Binderbyte |
| Email | Resend |

## Struktur

```
ecommerce-cf/
├── apps/
│   ├── api/              # Cloudflare Worker (Hono) — API utama
│   │   ├── src/
│   │   │   ├── index.ts              # Entry point + cron + queue handler
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts           # Register, login, guest OTP
│   │   │   │   ├── catalog.ts        # Products, categories
│   │   │   │   ├── cart.ts           # Guest + user cart (KV)
│   │   │   │   ├── checkout.ts       # Checkout + warehouse routing
│   │   │   │   ├── payment.ts        # Midtrans + Xendit + webhook
│   │   │   │   ├── shipping.ts       # Ongkir + cek resi
│   │   │   │   ├── warehouse.ts      # Multi-warehouse + transfer
│   │   │   │   └── admin.ts          # Admin orders + shipment
│   │   │   ├── middleware/
│   │   │   │   └── auth.ts           # JWT + guest session
│   │   │   ├── services/
│   │   │   │   └── inventory.ts      # Stock release/deduct
│   │   │   ├── jobs/
│   │   │   │   ├── resi-poller.ts    # Cron poll resi
│   │   │   │   └── notifications.ts  # Queue notif + payment expiry
│   │   │   └── durable-objects/
│   │   │       └── stock-lock-do.ts  # Atomic stock lock
│   │   └── wrangler.toml
│   └── storefront/       # Remix (Cloudflare Pages)
│       └── app/routes/
│           ├── checkout.tsx
│           └── track.tsx
├── packages/
│   ├── db/               # Drizzle schema + D1 client
│   │   ├── src/schema/
│   │   │   ├── catalog.ts    # users, products, variants, categories
│   │   │   ├── warehouse.ts  # warehouses, inventory, movements, transfers
│   │   │   └── orders.ts     # orders, order_items, payments, shipments
│   │   └── migrations/   # SQL hasil drizzle-kit generate
│   └── shared/           # Types, validators (Zod), constants
├── deployments/          # Satu berkas .env per klien — GITIGNORED
│   └── example.env       #   kecuali ini: dokumentasi formatnya
└── scripts/
    ├── profile.mjs       # Definisi profil deployment + penurunan nama resource
    ├── setup.sh          # Provisioning Cloudflare untuk satu profil
    ├── gen-wrangler.mjs  # wrangler.toml + profil → config deploy
    ├── db-migrate.mjs    # Satu-satunya jalur migrasi D1
    ├── check-deploy-config.mjs  # Penjaga sebelum deploy
    └── deploy.mjs        # Deploy berurutan: migrasi → Worker → Pages
```

## Dev Lokal

D1/KV/R2/Queues disimulasikan lewat Miniflare, jadi tidak perlu resource
Cloudflare sama sekali:

```bash
pnpm install
pnpm db:migrate                                    # migrasi ke D1 lokal
cp apps/api/.dev.vars.example apps/api/.dev.vars   # isi JWT_SECRET & ADMIN_BOOTSTRAP_SECRET
pnpm dev
```

## Deploy: Profil per Klien

Satu repo melayani banyak toko. Yang membedakan tiap deployment hanya
**deployments/`<profil>`.env** — nama profil, domain, dan ID resource
Cloudflare-nya. Berkas itu tidak dilacak git.

Prinsipnya: **nol berkas ter-track yang perlu diedit per klien.** Kalau
menambah klien mengharuskan mengubah berkas yang di-commit, dua klien akan
berebut berkas yang sama dan setiap `git pull` dari template berakhir konflik.

Nama profil ikut jadi awalan nama resource Cloudflare (`meadza-api`,
`meadza-db`, `meadza-notification-queue`, …), karena dua deployment dalam satu
akun tidak boleh punya nama resource yang sama.

```bash
# 1. Login ke Cloudflare (sekali per akun)
npx wrangler login

# 2. Buat profil — pertama kali ia hanya membuat kerangkanya
./scripts/setup.sh meadza

# 3. Isi domain di deployments/meadza.env
#    STORE_URL, ADMIN_URL, API_BASE, EMAIL_FROM_NAME, EMAIL_FROM_ADDRESS

# 4. Jalankan lagi — provisioning D1, 3x KV, R2, 2x Queue, lalu migrasi
./scripts/setup.sh meadza

# 5. Isi secret (daftar lengkapnya dicetak di akhir langkah 4)
cd apps/api
npx wrangler secret put JWT_SECRET --config wrangler.meadza.generated.toml
# … dst
cd ../..

# 6. Deploy: migrasi → Worker → Pages storefront & admin
pnpm run deploy:client meadza
```

Klien berikutnya tinggal mengulang dengan nama lain:

```bash
./scripts/setup.sh larizq
pnpm run deploy:client larizq

pnpm run profiles          # daftar profil yang ada
```

Beberapa catatan yang menghemat waktu:

- **Storefront dan admin dibangun ulang per klien.** `VITE_API_BASE` dibakar
  saat build, jadi artefak build satu klien tidak bisa dipakai klien lain —
  `deploy:client` yang mengurus ini.
- **Urutannya dijaga**, bukan diserahkan ke kebiasaan: migrasi dulu, baru
  Worker, baru Pages. Lihat bagian Migrasi Database di bawah.
- **Deploy sebagian**: `pnpm run deploy:client meadza --only=admin`
- **deployments/`<profil>`.env tidak ada di git.** Simpan cadangannya sendiri —
  berkas itulah yang menghubungkan repo ini dengan resource Cloudflare klien
  tersebut. Kehilangan berkas itu berarti mencari ID-nya lagi satu per satu
  lewat dashboard.

## Migrasi Database

Semua migrasi lewat satu perintah dan tercatat di tabel `d1_migrations`, jadi
yang sudah dijalankan tidak akan terulang:

```bash
pnpm db:status           # apa yang sudah & belum diterapkan (lokal)
pnpm db:migrate          # jalankan yang belum (lokal)

# Remote selalu menyasar satu klien, jadi profilnya wajib disebut
pnpm db:status:remote  -- --profile meadza
pnpm db:migrate:remote -- --profile meadza
```

Mengubah schema di `packages/db/src/schema/` → `pnpm db:generate` untuk membuat
SQL migrasinya, lalu commit hasilnya.

**Migrasi dijalankan sebelum deploy Worker, bukan sesudah.** `deploy:client`
menjalankannya sendiri, dan menolak jalan selama masih ada migrasi tertunda.
Urutan ini bukan selera: migrasi `0004` menyalin `qty_available` ke
`qty_on_hand` sebelum menjatuhkan kolom lamanya — kalau Worker versi baru sudah
menulis duluan, angka-angka itu ditimpa data basi tanpa error apa pun.

### Database yang sudah ada sebelum ada pelacakan

Kalau database ini pernah dimigrasi ketika repo belum punya pelacakan, ia berisi
tabel tapi tidak punya `d1_migrations`. Menjalankan `db:migrate` di situ akan
mengulang dari `0000` dan gagal di tabel yang sudah ada — jadi perintahnya
menolak, dan menyuruh mengadopsi dulu:

```bash
pnpm db:baseline              # baca skema, simpulkan sudah sampai mana (belum menulis)
pnpm db:baseline -- --write   # tulis catatannya
pnpm db:migrate               # lanjutkan sisanya
```

Untuk D1 di Cloudflare, pakai varian `:remote` dan sebutkan profilnya:
`pnpm db:baseline:remote -- --profile meadza --write`.

`baseline` tidak menjalankan ulang SQL apa pun — ia hanya mencatat apa yang
sudah ada. Cukup sekali per database.

## Migration Path ke Neon PostgreSQL

Ketika traffic sudah besar dan butuh concurrent writes lebih kuat:

1. Buat Neon database dan Hyperdrive di Cloudflare Dashboard
2. Di `packages/db/src/client.ts`: uncomment blok Neon, comment blok D1
3. Di `apps/api/wrangler.toml`: uncomment `[[hyperdrive]]`
4. Ganti `createD1Client(c.env.DB)` → `createNeonClient(c.env.HYPERDRIVE.connectionString)` di semua routes
5. Run `pnpm db:generate`, lalu terapkan lewat `drizzle-kit migrate` — `pnpm db:migrate`
   di repo ini khusus D1 (lewat wrangler) dan tidak berlaku untuk Postgres

Schema Drizzle **tidak perlu diubah** — hanya dialect yang berbeda.

## Key Design Decisions

- **Guest checkout**: `user_id NULL` di tabel `orders`, `guest_email` wajib
- **Stock reservation**: Durable Objects untuk atomic lock, D1 untuk persistensi
- **Resi cache**: KV 30 menit untuk kurangi biaya API Binderbyte
- **Webhook idempotency**: Cek `payment.status === "paid"` sebelum proses ulang
- **Warehouse routing**: Nearest + priority-based, fallback ke gudang lain jika stok habis
- **Cart session**: Header `X-Cart-Id` untuk guest, merge ke user cart saat login

## Lisensi

[Apache License 2.0](LICENSE)
