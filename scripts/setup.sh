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
#
# Keluarannya ditampung dulu, baru di-eval: pada `eval "$(cmd)" || fail`, status
# keluar yang diperiksa adalah milik eval, bukan cmd — perintah yang gagal
# menghasilkan `eval ""` yang sukses, dan kegagalannya baru muncul jauh di bawah
# sebagai "unbound variable".
PROFILE_VARS="$(node "$SCRIPT_DIR/profile.mjs" print "$PROFILE")" || fail "Profil tidak lengkap — lihat pesan di atas"
eval "$PROFILE_VARS"

log "Cek autentikasi wrangler"
WHOAMI=$(cd "$API_DIR" && npx wrangler whoami 2>&1) || { echo "$WHOAMI"; fail "Belum login. Jalankan: npx wrangler login"; }
echo "$WHOAMI"

# ─── Akun Cloudflare ──────────────────────────────────────────────────────────
# Sebagian klien tinggal di akun agency, sebagian punya akunnya sendiri. Kalau
# profil belum menyebut akun mana, resource dibuat di akun yang kebetulan aktif —
# dan resource produksi klien yang lahir di akun yang salah tidak bisa dipindah,
# hanya bisa dibuat ulang. Karena itu akunnya dipastikan SEKARANG, lalu
# disematkan ke profil supaya semua perintah berikutnya menyasar akun yang sama.
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  export CLOUDFLARE_ACCOUNT_ID
  log "Akun Cloudflare: $CLOUDFLARE_ACCOUNT_ID (dari profil)"
else
  AKUN_IDS=$(printf '%s\n' "$WHOAMI" | node "$SCRIPT_DIR/profile.mjs" accounts)
  JUMLAH=$(printf '%s' "$AKUN_IDS" | grep -c . || true)

  if [ "$JUMLAH" -eq 1 ]; then
    CLOUDFLARE_ACCOUNT_ID="$AKUN_IDS"
    export CLOUDFLARE_ACCOUNT_ID
    node "$SCRIPT_DIR/profile.mjs" set "$PROFILE" "CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID"
    log "Akun Cloudflare: $CLOUDFLARE_ACCOUNT_ID (disematkan ke profil)"
  elif [ "$JUMLAH" -gt 1 ]; then
    fail "Login ini punya akses ke $JUMLAH akun Cloudflare:

$AKUN_IDS

Sebutkan yang mana untuk klien \"$PROFILE\" — menebak berarti resource produksi
bisa lahir di akun klien lain:

  CLOUDFLARE_ACCOUNT_ID=<salah satu di atas>

isikan ke deployments/$PROFILE.env, lalu jalankan lagi script ini."
  else
    warn "ID akun tidak terbaca dari whoami — melanjutkan dengan akun bawaan wrangler"
  fi
fi

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

# Tiga variabel terpisah, bukan associative array: `declare -A` butuh bash 4,
# sedangkan macOS masih mengirim bash 3.2 — dan di situlah script ini paling
# sering dijalankan pertama kali.
#
# Log fungsi ini pergi ke stderr supaya stdout-nya hanya berisi ID, yang lalu
# ditangkap pemanggil lewat $( ).
ensure_kv() {
  local binding="$1" existing out id
  log "KV namespace: $binding" >&2

  existing=$(kv_id_for "${WORKER_NAME}-${binding}")
  if [ -n "$existing" ]; then
    warn "sudah ada, dipakai kembali ($existing)" >&2
    printf '%s' "$existing"
    return 0
  fi

  out=$(wr kv namespace create "$binding" 2>&1) || { echo "$out" >&2; fail "Gagal membuat KV namespace $binding"; }
  echo "$out" >&2
  id=$(echo "$out" | grep -m1 -E '^[[:space:]]*id[[:space:]]*=' | sed -E 's/.*"(.*)".*/\1/')
  [ -n "$id" ] || fail "Tidak berhasil membaca id KV $binding dari output di atas"
  printf '%s' "$id"
}

CART_KV_ID=$(ensure_kv CART_KV)
SESSION_KV_ID=$(ensure_kv SESSION_KV)
CACHE_KV_ID=$(ensure_kv CACHE_KV)

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

# ─── Pages projects ───────────────────────────────────────────────────────────
# Dibuat di sini, bukan dibiarkan lahir saat deploy pertama. `wrangler pages
# deploy` pada project yang belum ada punya dua perilaku, dan dua-duanya buruk
# untuk alur terscript: di terminal ia menyela dengan pertanyaan (termasuk nama
# production branch, yang bawaannya nama branch git yang sedang aktif — bukan
# yang kita mau), dan tanpa TTY ia melewati pembuatan lalu gagal jauh di
# belakang saat unggahan menyentuh project yang tidak ada.
#
# Perintah pages tidak menerima --config, jadi tidak lewat wr(). Sasaran akunnya
# tetap benar karena CLOUDFLARE_ACCOUNT_ID sudah diekspor di atas.
buat_pages_project() {
  local NAMA="$1" APP="$2"
  local APP_TOML="$ROOT_DIR/apps/$APP/wrangler.toml"
  local CD FLAGS OUT

  # Diambil dari wrangler.toml app-nya supaya tidak ada tanggal/flag kembar yang
  # bisa menyimpang dari yang dipakai saat build.
  CD=$(grep -m1 '^compatibility_date' "$APP_TOML" | sed -E 's/.*"(.*)".*/\1/')
  FLAGS=$(grep -m1 '^compatibility_flags' "$APP_TOML" | sed -E 's/.*\[(.*)\].*/\1/' | tr -d '" ' | tr ',' ' ')

  log "Pages project: $NAMA (production branch: $PAGES_BRANCH)"
  # shellcheck disable=SC2086
  if OUT=$(cd "$ROOT_DIR/apps/$APP" && npx wrangler pages project create "$NAMA" \
             --production-branch "$PAGES_BRANCH" \
             ${CD:+--compatibility-date "$CD"} \
             ${FLAGS:+--compatibility-flags $FLAGS} 2>&1); then
    echo "$OUT"
  else
    echo "$OUT" | grep -qi "already\|exists\|8000009" || { echo "$OUT"; fail "Gagal membuat Pages project $NAMA"; }
    warn "sudah ada, dilewati"
  fi
}

buat_pages_project "$PAGES_STOREFRONT" storefront
buat_pages_project "$PAGES_ADMIN" admin

# ─── Simpan ID & render config ────────────────────────────────────────────────
log "Menyimpan ID resource ke deployments/$PROFILE.env"
node "$SCRIPT_DIR/profile.mjs" set "$PROFILE" \
  "D1_DATABASE_ID=$D1_ID" \
  "CART_KV_ID=$CART_KV_ID" \
  "SESSION_KV_ID=$SESSION_KV_ID" \
  "CACHE_KV_ID=$CACHE_KV_ID"

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

Secret masih butuh API key asli tiap provider, jadi diisi manual — tapi sekali
di satu berkas, bukan satu per satu lewat prompt:

  node scripts/secrets.mjs scaffold --profile $PROFILE   # buat kerangkanya
  \$EDITOR deployments/$PROFILE.secrets.env               # isi nilainya
  node scripts/secrets.mjs push --profile $PROFILE       # unggah sekaligus

Isi juga ADMIN_BOOTSTRAP_SECRET di berkas yang sama (barisnya masih dikomentari)
kalau admin pertama belum ada — dan hapus lagi setelah admin dibuat.

Lalu deploy (config & migrasi tertunda diperiksa dulu, deploy dibatalkan kalau
ada yang belum beres):

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
