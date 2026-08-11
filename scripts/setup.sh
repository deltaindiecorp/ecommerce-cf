#!/usr/bin/env bash
# Provisioning resource Cloudflare untuk satu deployment (satu klien) dari
# template ini. Aman dijalankan ulang — setiap `create` akan gagal jelas
# kalau resource dengan nama sama sudah ada, bukan diam-diam duplikat.
#
# Dipakai sekali per klien baru: clone repo, jalankan script ini di dalam
# clone tersebut, lalu isi secret & deploy. Lihat README bagian Quick Start.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$SCRIPT_DIR/../apps/api"
DB_DIR="$SCRIPT_DIR/../packages/db"
WRANGLER_TOML="$API_DIR/wrangler.toml"
# Hasil provisioning ditulis ke berkas TERPISAH yang gitignored, bukan menimpa
# wrangler.toml. Versi lama menimpanya langsung, sehingga setiap clone klien
# langsung menyimpang dari template pada berkas yang persis sama — dan setiap
# `git pull` untuk menarik perbaikan berakhir konflik di situ, selamanya.
#
# Dengan cara ini clone klien tetap identik dengan template; yang berbeda hanya
# berkas yang memang tidak dilacak git.
GENERATED_TOML="$API_DIR/wrangler.generated.toml"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31mError: %s\033[0m\n' "$1" >&2; exit 1; }

command -v npx >/dev/null || fail "npx tidak ditemukan — install Node.js dulu"
[ -f "$WRANGLER_TOML" ] || fail "Tidak ketemu $WRANGLER_TOML — jalankan script ini dari clone repo yang lengkap"

log "Cek autentikasi wrangler"
(cd "$API_DIR" && npx wrangler whoami) || fail "Belum login. Jalankan: npx wrangler login"

# Ambil nama resource dari wrangler.toml supaya nama di script & config
# tidak pernah drift satu sama lain (wrangler.toml tetap sumber kebenaran).
DB_NAME=$(grep -m1 '^database_name' "$WRANGLER_TOML" | sed -E 's/.*"(.*)".*/\1/')
BUCKET_NAME=$(grep -m1 '^bucket_name' "$WRANGLER_TOML" | sed -E 's/.*"(.*)".*/\1/')
[ -n "$DB_NAME" ] || fail "database_name tidak ketemu di wrangler.toml"
[ -n "$BUCKET_NAME" ] || fail "bucket_name tidak ketemu di wrangler.toml"

extract_id() {
  # $1 = output perintah wrangler, $2 = nama field TOML ("database_id" / "id")
  echo "$1" | grep -m1 "^$2 = " | sed -E 's/.*"(.*)".*/\1/'
}

log "Membuat D1 database: $DB_NAME"
D1_OUT=$(cd "$API_DIR" && npx wrangler d1 create "$DB_NAME" 2>&1) || { echo "$D1_OUT"; fail "Gagal membuat D1 database (mungkin sudah ada?)"; }
echo "$D1_OUT"
DB_ID=$(extract_id "$D1_OUT" "database_id")
[ -n "$DB_ID" ] || fail "Tidak berhasil membaca database_id dari output wrangler di atas"

log "Membuat KV namespace: CART_KV"
CART_OUT=$(cd "$API_DIR" && npx wrangler kv namespace create CART_KV 2>&1) || { echo "$CART_OUT"; fail "Gagal membuat KV namespace CART_KV"; }
echo "$CART_OUT"
CART_KV_ID=$(extract_id "$CART_OUT" "id")
[ -n "$CART_KV_ID" ] || fail "Tidak berhasil membaca id dari output CART_KV di atas"

log "Membuat KV namespace: SESSION_KV"
SESSION_OUT=$(cd "$API_DIR" && npx wrangler kv namespace create SESSION_KV 2>&1) || { echo "$SESSION_OUT"; fail "Gagal membuat KV namespace SESSION_KV"; }
echo "$SESSION_OUT"
SESSION_KV_ID=$(extract_id "$SESSION_OUT" "id")
[ -n "$SESSION_KV_ID" ] || fail "Tidak berhasil membaca id dari output SESSION_KV di atas"

log "Membuat KV namespace: CACHE_KV"
CACHE_OUT=$(cd "$API_DIR" && npx wrangler kv namespace create CACHE_KV 2>&1) || { echo "$CACHE_OUT"; fail "Gagal membuat KV namespace CACHE_KV"; }
echo "$CACHE_OUT"
CACHE_KV_ID=$(extract_id "$CACHE_OUT" "id")
[ -n "$CACHE_KV_ID" ] || fail "Tidak berhasil membaca id dari output CACHE_KV di atas"

log "Membuat R2 bucket: $BUCKET_NAME"
(cd "$API_DIR" && npx wrangler r2 bucket create "$BUCKET_NAME") || fail "Gagal membuat R2 bucket (mungkin sudah ada?)"

log "Membuat Queues"
(cd "$API_DIR" && npx wrangler queues create notification-queue) || fail "Gagal membuat notification-queue"
(cd "$API_DIR" && npx wrangler queues create resi-poll-queue) || fail "Gagal membuat resi-poll-queue"

log "Menulis konfigurasi deploy ke $(basename "$GENERATED_TOML")"
{
  echo "# DIHASILKAN OLEH scripts/setup.sh — JANGAN di-commit."
  echo "# Berkas ini berisi ID resource Cloudflare milik deployment ini."
  echo "# Sumbernya wrangler.toml; jalankan ulang setup.sh kalau template berubah."
  echo "#"
  echo "# Dihasilkan: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo ""
  sed \
    -e "s/YOUR_D1_DATABASE_ID/$DB_ID/" \
    -e "s/YOUR_CART_KV_ID/$CART_KV_ID/" \
    -e "s/YOUR_SESSION_KV_ID/$SESSION_KV_ID/" \
    -e "s/YOUR_CACHE_KV_ID/$CACHE_KV_ID/" \
    "$WRANGLER_TOML"
} > "$GENERATED_TOML"

# Placeholder yang tersisa berarti wrangler.toml punya ID baru yang belum
# dikenal script ini — lebih baik gagal sekarang daripada deploy dengan binding
# yang menunjuk ke mana-mana.
if grep -q "YOUR_[A-Z_]*_ID" "$GENERATED_TOML"; then
  grep -n "YOUR_[A-Z_]*_ID" "$GENERATED_TOML" >&2
  fail "Masih ada placeholder yang belum terisi di $(basename "$GENERATED_TOML") — lihat baris di atas"
fi

log "Menjalankan migration D1 (remote)"
for f in "$DB_DIR"/migrations/*.sql; do
  echo "  -> $(basename "$f")"
  (cd "$API_DIR" && npx wrangler d1 execute "$DB_NAME" --remote --config "$GENERATED_TOML" --file="$f")
done

log "Selesai — resource Cloudflare siap"
cat <<EOF

Langkah selanjutnya (manual, butuh API key asli dari masing-masing provider):

  cd apps/api
  npx wrangler secret put JWT_SECRET --config wrangler.generated.toml
  npx wrangler secret put MIDTRANS_SERVER_KEY
  npx wrangler secret put MIDTRANS_CLIENT_KEY
  npx wrangler secret put XENDIT_SECRET_KEY
  npx wrangler secret put XENDIT_WEBHOOK_TOKEN
  npx wrangler secret put RAJAONGKIR_API_KEY
  npx wrangler secret put BINDERBYTE_API_KEY
  npx wrangler secret put RESEND_API_KEY
  npx wrangler secret put ADMIN_BOOTSTRAP_SECRET   # isi sementara, kosongkan lagi setelah admin pertama dibuat

Lalu buat admin pertama:
  curl -X POST https://<api-worker-url>/api/auth/bootstrap-admin \\
    -H "Content-Type: application/json" \\
    -H "X-Bootstrap-Secret: <isi sama dengan secret di atas>" \\
    -d '{"name":"Admin","email":"admin@domain-kamu.com","phone":"08xxxxxxxxxx","password":"password-kuat"}'

Baru setelah itu deploy:
  pnpm deploy

Catatan: wrangler.generated.toml TIDAK dilacak git dan tidak boleh di-commit —
isinya ID resource khusus deployment ini. Kalau wrangler.toml berubah karena
menarik perbaikan dari template, jalankan setup.sh ulang untuk membuatnya lagi.
EOF
