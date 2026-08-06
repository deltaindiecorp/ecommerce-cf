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

Untuk dev lokal tanpa resource Cloudflare asli (D1/KV/R2/Queues disimulasikan lewat Miniflare), cukup jalankan migrasi ke database lokal lalu `pnpm dev`:

```bash
cd apps/api
for f in ../../packages/db/migrations/*.sql; do
  npx wrangler d1 execute ecommerce-db --local --file="$f"
done
cp .dev.vars.example .dev.vars   # isi JWT_SECRET & ADMIN_BOOTSTRAP_SECRET buat dev
cd ../..
pnpm dev
```

## Migration Path ke Neon PostgreSQL

Ketika traffic sudah besar dan butuh concurrent writes lebih kuat:

1. Buat Neon database dan Hyperdrive di Cloudflare Dashboard
2. Di `packages/db/src/client.ts`: uncomment blok Neon, comment blok D1
3. Di `apps/api/wrangler.toml`: uncomment `[[hyperdrive]]`
4. Ganti `createD1Client(c.env.DB)` → `createNeonClient(c.env.HYPERDRIVE.connectionString)` di semua routes
5. Run `pnpm db:generate && pnpm db:migrate`

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
