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
└── packages/
    ├── db/               # Drizzle schema + D1 client
    │   └── src/schema/
    │       ├── catalog.ts    # users, products, variants, categories
    │       ├── warehouse.ts  # warehouses, inventory, movements, transfers
    │       └── orders.ts     # orders, order_items, payments, shipments
    └── shared/           # Types, validators (Zod), constants
```

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Login ke Cloudflare (sekali saja per akun)
npx wrangler login

# 3. Provisioning semua resource Cloudflare + suntik ID ke wrangler.toml
#    (otomatis: D1, 3x KV, R2, 2x Queue, migration D1 remote)
./scripts/setup.sh

# 4. Isi secret (lihat daftar lengkap di akhir output scripts/setup.sh)
cd apps/api
wrangler secret put JWT_SECRET
wrangler secret put MIDTRANS_SERVER_KEY
wrangler secret put XENDIT_SECRET_KEY
wrangler secret put RAJAONGKIR_API_KEY
wrangler secret put BINDERBYTE_API_KEY
wrangler secret put RESEND_API_KEY
cd ../..

# 5. Dev mode
pnpm dev

# 6. Deploy
pnpm deploy
```

Untuk dev lokal tanpa resource Cloudflare asli (D1/KV/R2/Queues disimulasikan lewat Miniflare):

```bash
pnpm db:migrate                          # migrasi ke D1 lokal
cp apps/api/.dev.vars.example apps/api/.dev.vars   # isi JWT_SECRET & ADMIN_BOOTSTRAP_SECRET
pnpm dev
```

## Migrasi Database

Semua migrasi lewat satu perintah dan tercatat di tabel `d1_migrations`, jadi
yang sudah dijalankan tidak akan terulang:

```bash
pnpm db:status           # apa yang sudah & belum diterapkan (lokal)
pnpm db:migrate          # jalankan yang belum (lokal)

pnpm db:status:remote    # sama, untuk D1 di Cloudflare
pnpm db:migrate:remote
```

Mengubah schema di `packages/db/src/schema/` → `pnpm db:generate` untuk membuat
SQL migrasinya, lalu commit hasilnya.

**Migrasi dijalankan sebelum deploy Worker, bukan sesudah.** `pnpm deploy` akan
menolak jalan selama masih ada migrasi tertunda. Urutan ini bukan selera:
migrasi `0004` menyalin `qty_available` ke `qty_on_hand` sebelum menjatuhkan
kolom lamanya — kalau Worker versi baru sudah menulis duluan, angka-angka itu
ditimpa data basi tanpa error apa pun.

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

`baseline` tidak menjalankan ulang SQL apa pun — ia hanya mencatat apa yang
sudah ada. Cukup sekali per database. Ganti ke `db:baseline:remote` untuk D1 di
Cloudflare.

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
