#!/usr/bin/env bash
# Provisioning resource Cloudflare untuk SATU profil deployment (satu klien).
#
#   ./scripts/setup.sh meadza
#
# Semua klien memakai repo yang sama — tidak ada clone per klien, dan tidak ada
# berkas ter-track yang perlu diedit. Yang membedakan mereka hanya
# deployments/<profil>.env (gitignored) dan config hasil generate darinya.
#
# Aman dijalankan ulang: resource yang sudah ada dicari ID-nya, bukan membuat
# script berhenti. Ini penting karena provisioning bisa gagal di tengah — mis.
# setelah D1 jadi tapi sebelum queue dibuat — dan tanpa itu tidak ada jalan maju
# selain membereskan manual.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31mError: %s\033[0m\n' "$1" >&2; exit 1; }

PROFILE="${1:-}"
[ -n "$PROFILE" ] || fail "Sebutkan nama profil. Contoh: ./scripts/setup.sh meadza

Satu profil = satu klien. Nama ini jadi awalan nama resource Cloudflare,
sehingga beberapa klien bisa hidup berdampingan dalam satu akun.

Profil yang sudah ada: $(node "$SCRIPT_DIR/profile.mjs" list 2>/dev/null | tr '\n' ' ')"

command -v npx  >/dev/null || fail "npx tidak ditemukan — install Node.js dulu"
command -v node >/dev/null || fail "node tidak ditemukan — install Node.js dulu"

PROFILE_FILE="$ROOT_DIR/deployments/$PROFILE.env"
if [ ! -f "$PROFILE_FILE" ]; then
  log "Membuat kerangka profil: deployments/$PROFILE.env"
  node "$SCRIPT_DIR/profile.mjs" scaffold "$PROFILE" >/dev/null || fail "Gagal membuat profil"
  cat <<EOF

Kerangka profil sudah dibuat. Isi dulu nilai wajibnya:

  $PROFILE_FILE

  STORE_URL, ADMIN_URL, API_BASE, EMAIL_FROM_NAME, EMAIL_FROM_ADDRESS

Domain-domain ini masuk ke CORS dan ke tautan di email, jadi sengaja tidak
ditebak — salah isi baru ketahuan saat produksi menolak request.

Setelah terisi, jalankan lagi:  ./scripts/setup.sh $PROFILE
EOF
  exit 0
fi

# Satu-satunya definisi penurunan nama ada di profile.mjs; bash memakainya
# lewat eval supaya keduanya tidak pernah drift.
eval "$(node "$SCRIPT_DIR/profile.mjs" print "$PROFILE")" || fail "Profil tidak lengkap — lihat pesan di atas"

log "Cek autentikasi wrangler"
(cd "$API_DIR" && npx wrangler whoami) || fail "Belum login. Jalankan: npx wrangler login"

# Config bootstrap sementara. Perintah `kv namespace create` menurunkan judul
# namespace dari `name` di config, jadi config yang dipakai saat provisioning
# harus sudah bernama sesuai profil — kalau tidak, judulnya bertabrakan antar
# klien. Config sungguhan belum bisa dipakai di tahap ini karena wrangler
# menolak kv id yang masih kosong.
BOOTSTRAP_TOML="$(mktemp -t wrangler-bootstrap-XXXXXX).toml"
trap 'rm -f "$BOOTSTRAP_TOML"' EXIT
printf 'name = "%s"\ncompatibility_date = "2024-09-23"\n' "$WORKER_NAME" > "$BOOTSTRAP_TOML"

wr() { (cd "$API_DIR" && npx wrangler "$@" --config "$BOOTSTRAP_TOML"); }

# ─── D1 ───────────────────────────────────────────────────────────────────────
log "D1 database: $D1_NAME"
D1_ID=$(wr d1 list --json 2>/dev/null | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const db=JSON.parse(s).find(d=>d.name===process.argv[1]); console.log(db?(db.uuid||db.database_id||""):""); }
    catch { console.log(""); }
  });' "$D1_NAME" || true)

if [ -n "$D1_ID" ]; then
  warn "sudah ada, dipakai kembali ($D1_ID)"
else
  OUT=$(wr d1 create "$D1_NAME" 2>&1) || { echo "$OUT"; fail "Gagal membuat D1 database"; }
  echo "$OUT"
  D1_ID=$(echo "$OUT" | grep -m1 'database_id' | sed -E 's/.*"(.*)".*/\1/')
  [ -n "$D1_ID" ] || fail "Tidak berhasil membaca database_id dari output di atas"
fi

# ─── KV ───────────────────────────────────────────────────────────────────────
# Judul namespace yang dibentuk wrangler: <nama-worker>-<binding>.
kv_id_for() {
  wr kv namespace list 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { const ns=JSON.parse(s).find(n=>n.title===process.argv[1]); console.log(ns?ns.id:""); }
      catch { console.log(""); }
    });' "$1" || true
}

declare -A KV_IDS
for BINDING in CART_KV SESSION_KV CACHE_KV; do
  log "KV namespace: $BINDING"
  EXISTING=$(kv_id_for "${WORKER_NAME}-${BINDING}")
  if [ -n "$EXISTING" ]; then
    warn "sudah ada, dipakai kembali ($EXISTING)"
    KV_IDS[$BINDING]="$EXISTING"
  else
    OUT=$(wr kv namespace create "$BINDING" 2>&1) || { echo "$OUT"; fail "Gagal membuat KV namespace $BINDING"; }
    echo "$OUT"
    ID=$(echo "$OUT" | grep -m1 -E '^\s*id\s*=' | sed -E 's/.*"(.*)".*/\1/')
    [ -n "$ID" ] || fail "Tidak berhasil membaca id KV $BINDING dari output di atas"
    KV_IDS[$BINDING]="$ID"
  fi
done

# ─── R2 & Queues ──────────────────────────────────────────────────────────────
# Keduanya diidentifikasi lewat nama, bukan ID, jadi "sudah ada" cukup dilewati.
log "R2 bucket: $R2_BUCKET"
if OUT=$(wr r2 bucket create "$R2_BUCKET" 2>&1); then echo "$OUT"; else
  echo "$OUT" | grep -qi "already\|exists\|10004" || { echo "$OUT"; fail "Gagal membuat R2 bucket"; }
  warn "sudah ada, dilewati"
fi

for Q in "$QUEUE_NOTIFICATION" "$QUEUE_RESI"; do
  log "Queue: $Q"
  if OUT=$(wr queues create "$Q" 2>&1); then echo "$OUT"; else
    echo "$OUT" | grep -qi "already\|exists" || { echo "$OUT"; fail "Gagal membuat queue $Q"; }
    warn "sudah ada, dilewati"
  fi
done

# ─── Simpan ID & render config ────────────────────────────────────────────────
log "Menyimpan ID resource ke deployments/$PROFILE.env"
node "$SCRIPT_DIR/profile.mjs" set "$PROFILE" \
  "D1_DATABASE_ID=$D1_ID" \
  "CART_KV_ID=${KV_IDS[CART_KV]}" \
  "SESSION_KV_ID=${KV_IDS[SESSION_KV]}" \
  "CACHE_KV_ID=${KV_IDS[CACHE_KV]}"

log "Merender apps/api/wrangler.$PROFILE.generated.toml"
node "$SCRIPT_DIR/gen-wrangler.mjs" --profile "$PROFILE" || fail "Gagal merender config"

GENERATED_TOML="$API_DIR/wrangler.$PROFILE.generated.toml"
# Hanya baris yang benar-benar aktif. Versi lama mencocokkan seluruh berkas,
# sehingga baris komentar `# id = "YOUR_HYPERDRIVE_ID"` di template membuat
# pemeriksaan ini SELALU gagal — tidak pernah ketahuan karena setup.sh memang
# belum pernah dijalankan sampai tuntas.
if grep -vE '^\s*#' "$GENERATED_TOML" | grep -q 'YOUR_[A-Z_]*_ID'; then
  grep -nvE '^\s*#' "$GENERATED_TOML" | grep 'YOUR_[A-Z_]*_ID' >&2
  fail "Masih ada placeholder yang belum terisi — lihat baris di atas"
fi

log "Menjalankan migration D1 (remote)"
(cd "$ROOT_DIR" && node scripts/db-migrate.mjs apply --remote --profile "$PROFILE")

log "Selesai — resource Cloudflare untuk \"$PROFILE\" siap"
cat <<EOF

Secret masih harus diisi manual (butuh API key asli tiap provider). Semuanya
melekat pada Worker "$WORKER_NAME", jadi --config wajib ikut:

  cd apps/api
  for S in JWT_SECRET MIDTRANS_SERVER_KEY MIDTRANS_CLIENT_KEY XENDIT_SECRET_KEY \\
           XENDIT_WEBHOOK_TOKEN RAJAONGKIR_API_KEY BINDERBYTE_API_KEY RESEND_API_KEY; do
    npx wrangler secret put \$S --config wrangler.$PROFILE.generated.toml
  done

  # Sementara — kosongkan lagi setelah admin pertama dibuat:
  npx wrangler secret put ADMIN_BOOTSTRAP_SECRET --config wrangler.$PROFILE.generated.toml

Lalu deploy (migrasi dijalankan lebih dulu secara otomatis):

  pnpm deploy:client $PROFILE

Setelah Worker hidup, buat admin pertama:

  curl -X POST $API_BASE/api/auth/bootstrap-admin \\
    -H "Content-Type: application/json" \\
    -H "X-Bootstrap-Secret: <isi sama dengan secret di atas>" \\
    -d '{"name":"Admin","email":"admin@$PROFILE.id","phone":"08xxxxxxxxxx","password":"password-kuat"}'

Catatan: deployments/$PROFILE.env dan wrangler.$PROFILE.generated.toml TIDAK
dilacak git. Simpan sendiri cadangannya — isinya yang menghubungkan repo ini
dengan resource Cloudflare milik klien tersebut.
EOF
