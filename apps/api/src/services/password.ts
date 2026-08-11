// ─── Hashing Password ─────────────────────────────────────────────────────────
// PBKDF2 lewat Web Crypto — tersedia di Workers tanpa dependency native.
// Diangkat dari routes/auth.ts supaya pembuatan user oleh admin memakai fungsi
// yang sama persis; dua implementasi hash yang berbeda berarti password buatan
// satu jalur tidak bisa diverifikasi jalur lain.

const ITERATIONS = 100_000;
const KEY_BITS   = 256;
const SALT_BYTES = 16;

async function deriveHex(password: string, salt: Uint8Array): Promise<string> {
  const keyMat = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, keyMat, KEY_BITS,
  );
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string): Promise<string> {
  const salt    = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${saltHex}:${await deriveHex(password, salt)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, storedHash] = stored.split(":");
  if (!saltHex || !storedHash) return false;

  const bytes = saltHex.match(/.{2}/g);
  if (!bytes) return false;

  const salt = new Uint8Array(bytes.map(b => parseInt(b, 16)));
  return (await deriveHex(password, salt)) === storedHash;
}
