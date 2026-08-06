-- Seed data demo/dev — 1 gudang, 11 kategori, 11 produk lengkap dengan stok.
-- ID pakai UUID asli (bukan slug seperti 'prod-xxx') karena addToCartSchema
-- mewajibkan productId berformat UUID — kalau ID bukan UUID, tombol "Tambah
-- ke Keranjang" akan gagal validasi (400 Invalid uuid).
--
-- Foto produk adalah aset lokal di apps/storefront/public/images/products/
-- (diunduh dari Unsplash, lisensi free-to-use) — bukan hotlink ke Unsplash,
-- jadi demo ini tetap jalan tanpa akses internet ke pihak ketiga saat runtime.
-- Aman dijalankan berkali-kali di database kosong; JANGAN dijalankan di
-- database yang sudah punya data (bentrok slug/sku unik).
--
-- Cara pakai (lokal):
--   cd apps/api
--   npx wrangler d1 execute ecommerce-db --local --file=../../packages/db/seed.sql
--
-- Cara pakai (remote, setelah provisioning via scripts/setup.sh):
--   npx wrangler d1 execute ecommerce-db --remote --file=../../packages/db/seed.sql

INSERT INTO warehouses (id, name, code, address, city, province, postal_code, rajaongkir_city_id, is_active, priority)
VALUES ('8c5ba592-4db4-42a9-853a-a6c519f1b169', 'Gudang Jakarta', 'JKT', 'Jl. Gudang No. 1', 'Jakarta Pusat', 'DKI Jakarta', '10310', 152, 1, 1);

INSERT INTO categories (id, name, slug, sort_order, is_active) VALUES
  ('7d42e90e-5d80-4f5a-ae5f-0416d7b1650a', 'Pakaian',             'pakaian',             1, 1),
  ('75d92305-f1a2-4a69-822c-02ceafc5b09c', 'Elektronik',          'elektronik',          2, 1),
  ('b08ce26c-557f-4052-a113-6e3b4fc1e63a', 'Fashion Pria',        'fashion-pria',        3, 1),
  ('74227040-2509-4f69-b9e6-4b2351289eaf', 'Fashion Wanita',      'fashion-wanita',      4, 1),
  ('ef4d79d0-5c48-4f0b-89e7-3f97efdb1844', 'Kecantikan',          'kecantikan',          5, 1),
  ('03293548-b0c5-49d0-a7f8-deccf0696233', 'Rumah Tangga',        'rumah-tangga',        6, 1),
  ('eafebcfa-6d8f-418f-b288-d115785c5d93', 'Olahraga',            'olahraga',            7, 1),
  ('e9a068d2-5d42-44ce-9478-9bd87dc24678', 'Makanan & Minuman',   'makanan-minuman',     8, 1),
  ('f6276e88-9512-4a24-8bd6-6e82ced734e3', 'Buku & Alat Tulis',   'buku-alat-tulis',     9, 1),
  ('7197cfbd-151c-427f-a8fd-dab017c0d0f3', 'Otomotif',            'otomotif',            10, 1),
  ('e9115538-65d2-4233-be74-6fafebf9efa3', 'Mainan & Hobi',       'mainan-hobi',         11, 1);

INSERT INTO products (id, category_id, name, slug, sku, description, price, compare_price, weight, images, status, is_featured, created_at) VALUES
  ('d2a042f3-aad3-4968-a1f6-725de34dfcc6', '7d42e90e-5d80-4f5a-ae5f-0416d7b1650a', 'Kaos Polos Hitam', 'kaos-polos-hitam', 'KP-001',
    'Kaos polos katun combed 24s, nyaman dipakai harian.',
    75000, NULL, 200, '["/images/products/kaos-polos-hitam.jpg"]', 'active', 1, NULL),

  ('ca47ead6-b358-4962-8a42-f188195dbc96', '75d92305-f1a2-4a69-822c-02ceafc5b09c', 'Earbuds Nirkabel Pro X', 'earbuds-nirkabel-pro-x', 'ELK-001',
    'Earbuds nirkabel dengan kualitas suara jernih dan baterai tahan lama, cocok untuk aktivitas harian.',
    350000, 500000, 150, '["/images/products/earbuds-nirkabel-pro-x.jpg"]', 'active', 1, unixepoch()),

  ('a32d8cec-512d-4fa5-805c-c56cee32fe57', 'b08ce26c-557f-4052-a113-6e3b4fc1e63a', 'Jaket Denim Casual Pria', 'jaket-denim-casual-pria', 'FSP-001',
    'Jaket denim casual dengan potongan modern, nyaman dipakai untuk gaya sehari-hari.',
    275000, NULL, 400, '["/images/products/jaket-denim-casual-pria.jpg"]', 'active', 0, NULL),

  ('0c6b7e67-fc8e-4536-b9ec-dc9350f5ca05', '74227040-2509-4f69-b9e6-4b2351289eaf', 'Dress Floral Musim Panas', 'dress-floral-musim-panas', 'FSW-001',
    'Dress motif floral yang ringan dan sejuk dipakai, cocok untuk acara santai maupun jalan-jalan.',
    189000, NULL, 200, '["/images/products/dress-floral-musim-panas.jpg"]', 'active', 1, unixepoch()),

  ('12bad082-e941-4172-b7bc-795b063190ba', 'ef4d79d0-5c48-4f0b-89e7-3f97efdb1844', 'Paket Perawatan Kulit Wajah', 'paket-perawatan-kulit-wajah', 'KEC-001',
    'Set perawatan wajah lengkap untuk membersihkan dan melembapkan kulit setiap hari.',
    145000, NULL, 300, '["/images/products/paket-perawatan-kulit-wajah.jpg"]', 'active', 0, NULL),

  ('cd3ba433-dcd9-422a-89ba-1f1f2fafe82d', '03293548-b0c5-49d0-a7f8-deccf0696233', 'Set Mug Keramik Minimalis', 'set-mug-keramik-minimalis', 'RT-001',
    'Set mug keramik dengan desain minimalis, cocok untuk kopi maupun teh favorit Anda.',
    89000, NULL, 600, '["/images/products/set-mug-keramik-minimalis.jpg"]', 'active', 0, NULL),

  ('07c9fc7b-a816-48a6-a60b-0b8e6cc00527', 'eafebcfa-6d8f-418f-b288-d115785c5d93', 'Sepatu Lari Performance', 'sepatu-lari-performance', 'OR-001',
    'Sepatu lari ringan dengan bantalan empuk untuk menunjang performa olahraga Anda.',
    420000, 599000, 800, '["/images/products/sepatu-lari-performance.jpg"]', 'active', 1, NULL),

  ('caadd781-8c6f-41e5-a655-df9accc6f1de', 'e9a068d2-5d42-44ce-9478-9bd87dc24678', 'Kopi Arabika Premium 250g', 'kopi-arabika-premium-250g', 'MM-001',
    'Biji kopi arabika pilihan, disangrai fresh untuk cita rasa yang kaya dan aromatik.',
    65000, NULL, 300, '["/images/products/kopi-arabika-premium.jpg"]', 'active', 1, NULL),

  ('0188c2d6-3dcd-4520-b494-b63e439f9e30', 'f6276e88-9512-4a24-8bd6-6e82ced734e3', 'Notebook & Alat Tulis Set', 'notebook-alat-tulis-set', 'BAT-001',
    'Set notebook dan alat tulis untuk kebutuhan catatan harian, kerja, maupun sekolah.',
    55000, NULL, 250, '["/images/products/notebook-alat-tulis-set.jpg"]', 'active', 0, NULL),

  ('831eb50b-012d-4f9d-b029-e25a6e9298f2', '7197cfbd-151c-427f-a8fd-dab017c0d0f3', 'Car Phone Holder Universal', 'car-phone-holder-universal', 'OTO-001',
    'Holder HP untuk mobil dengan penjepit kuat dan mudah dipasang di dashboard maupun ventilasi AC.',
    75000, NULL, 150, '["/images/products/car-phone-holder-universal.jpg"]', 'active', 0, NULL),

  ('eb98bfd1-1987-4910-9b26-0b48cc76dfaa', 'e9115538-65d2-4233-be74-6fafebf9efa3', 'Board Game Strategi Keluarga', 'board-game-strategi-keluarga', 'MH-001',
    'Board game seru untuk dimainkan bersama keluarga atau teman, melatih strategi dan kerja sama.',
    210000, NULL, 700, '["/images/products/board-game-strategi-keluarga.jpg"]', 'active', 1, unixepoch());

INSERT INTO inventory (id, warehouse_id, product_id, qty_available, qty_reserved, qty_on_hand) VALUES
  ('2ca51916-f856-4481-a402-1ec2813f9f7b', '8c5ba592-4db4-42a9-853a-a6c519f1b169', 'd2a042f3-aad3-4968-a1f6-725de34dfcc6', 50, 0, 50),
  ('a3281248-e21b-4012-b5dc-7694d31957bd', '8c5ba592-4db4-42a9-853a-a6c519f1b169', 'ca47ead6-b358-4962-8a42-f188195dbc96', 40, 0, 40),
  ('7df72c61-b7d6-4bae-91c5-0ec390934682', '8c5ba592-4db4-42a9-853a-a6c519f1b169', 'a32d8cec-512d-4fa5-805c-c56cee32fe57', 30, 0, 30),
  ('212ece91-ffca-4491-8cb4-4f2ced8eb98f', '8c5ba592-4db4-42a9-853a-a6c519f1b169', '0c6b7e67-fc8e-4536-b9ec-dc9350f5ca05', 25, 0, 25),
  ('2d8bb04b-4131-489b-91b6-488b4dcb4f62', '8c5ba592-4db4-42a9-853a-a6c519f1b169', '12bad082-e941-4172-b7bc-795b063190ba', 50, 0, 50),
  ('624074fe-0d62-4930-81f1-3e78f84c2611', '8c5ba592-4db4-42a9-853a-a6c519f1b169', 'cd3ba433-dcd9-422a-89ba-1f1f2fafe82d', 35, 0, 35),
  ('05ceb851-d8e2-4f9a-8b63-81d2c954773f', '8c5ba592-4db4-42a9-853a-a6c519f1b169', '07c9fc7b-a816-48a6-a60b-0b8e6cc00527', 20, 0, 20),
  ('d65d4ce4-2113-4fd8-b5c5-084ef63b19d9', '8c5ba592-4db4-42a9-853a-a6c519f1b169', 'caadd781-8c6f-41e5-a655-df9accc6f1de', 60, 0, 60),
  ('1b863dcc-73a5-476b-90d4-f44ce998f2d7', '8c5ba592-4db4-42a9-853a-a6c519f1b169', '0188c2d6-3dcd-4520-b494-b63e439f9e30', 45, 0, 45),
  ('91a73b2a-120d-45fe-abae-a30c33288a53', '8c5ba592-4db4-42a9-853a-a6c519f1b169', '831eb50b-012d-4f9d-b029-e25a6e9298f2', 30, 0, 30),
  ('8a0aa6af-d9d7-403f-a2d3-801fc944c44b', '8c5ba592-4db4-42a9-853a-a6c519f1b169', 'eb98bfd1-1987-4910-9b26-0b48cc76dfaa', 15, 0, 15);
