import { redirect } from "@remix-run/cloudflare";

import { API_BASE } from "./config";

// ─── Token ────────────────────────────────────────────────────────────────────
// Satu-satunya definisi. Sebelumnya fungsi ini tersalin di delapan berkas route.
export function getToken(request: Request): string {
  return request.headers.get("Cookie")?.match(/admin_token=([^;]+)/)?.[1] ?? "";
}

// ─── Bentuk respons API ───────────────────────────────────────────────────────
export type ApiBody<T = unknown> = {
  success: boolean;
  data?:   T;
  error?:  unknown;
  meta?:   { page: number; limit: number; total: number };
};

// Membaca body sekali sebagai teks lalu mem-parsing sendiri. `res.json()` yang
// gagal hanya memberi "Unexpected token <" tanpa menunjukkan apa yang sebenarnya
// dikirim — padahal justru itu petunjuknya (halaman error Cloudflare, HTML 502,
// atau route yang tidak ada).
async function parseJson(res: Response, path: string): Promise<ApiBody> {
  const text = await res.text();
  try {
    return JSON.parse(text) as ApiBody;
  } catch {
    throw new Response(
      `API membalas non-JSON untuk ${path} (HTTP ${res.status}). ` +
      `Awal respons: ${text.slice(0, 300) || "(kosong)"}`,
      { status: 502, statusText: "Respons API tidak valid" },
    );
  }
}

function unreachable(path: string, cause: unknown): Response {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Response(
    `Tidak bisa menghubungi API di ${API_BASE}${path} — ${detail}. ` +
    `Pastikan Worker API berjalan dan VITE_API_BASE menunjuk alamat yang benar.`,
    { status: 502, statusText: "API tidak terjangkau" },
  );
}

// ─── Panggilan terautentikasi ─────────────────────────────────────────────────
// Kontraknya: melempar (ditangkap ErrorBoundary) untuk kegagalan yang tidak bisa
// ditindaklanjuti pengguna — API mati, respons rusak, error server. Mengembalikan
// body apa adanya untuk 4xx yang membawa pesan berguna (validasi 400, bentrok
// 409), supaya form bisa menampilkannya di tempat.
//
// 401/403 diperlakukan khusus: sesi admin habis, jadi diarahkan ke /login.
// Sebelumnya kondisi ini berakhir jadi `success: false` yang di-fallback ke nol,
// sehingga dashboard menampilkan "Rp 0" seolah toko tidak berjualan.
export async function apiFetch<T = unknown>(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<ApiBody<T>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken(request)}`,
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (cause) {
    throw unreachable(path, cause);
  }

  if (res.status === 401 || res.status === 403) throw redirect("/login");

  if (res.status >= 500) {
    throw new Response(
      `API gagal memproses ${path} (HTTP ${res.status}).`,
      { status: 502, statusText: "API bermasalah" },
    );
  }

  return parseJson(res, path) as Promise<ApiBody<T>>;
}

// ─── Panggilan tanpa autentikasi ──────────────────────────────────────────────
// Untuk endpoint publik dan login. Tidak mengarahkan ke /login pada 401 — di
// halaman login, 401 justru berarti "password salah" dan harus ditampilkan.
export async function apiPublic<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<ApiBody<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (cause) {
    throw unreachable(path, cause);
  }

  if (res.status >= 500) {
    throw new Response(
      `API gagal memproses ${path} (HTTP ${res.status}).`,
      { status: 502, statusText: "API bermasalah" },
    );
  }

  return parseJson(res, path) as Promise<ApiBody<T>>;
}

// ─── Menampilkan error API ────────────────────────────────────────────────────
// `error` bertipe unknown karena bisa berupa string dari API atau hasil
// zod .flatten(). Beberapa halaman sebelumnya merender JSON.stringify() mentah,
// jadi admin melihat {"formErrors":[],"fieldErrors":{"slug":["..."]}} apa adanya.
export function formatApiError(error: unknown): string {
  if (error == null) return "";
  if (typeof error === "string") return error;

  if (typeof error === "object") {
    const e = error as { formErrors?: unknown; fieldErrors?: Record<string, unknown> };
    const parts: string[] = [];

    if (Array.isArray(e.formErrors)) parts.push(...e.formErrors.map(String));

    if (e.fieldErrors && typeof e.fieldErrors === "object") {
      for (const [field, msgs] of Object.entries(e.fieldErrors)) {
        if (Array.isArray(msgs) && msgs.length) parts.push(`${field}: ${msgs.map(String).join(", ")}`);
      }
    }

    if (parts.length) return parts.join("\n");
  }

  return JSON.stringify(error, null, 2);
}
