import { API_BASE } from "./config";
import { getAuthToken } from "./session";

// ─── Pemanggilan API storefront ───────────────────────────────────────────────
// Diadaptasi dari apps/admin/app/lib/api.ts. Bedanya satu hal penting: storefront
// sebagian besar publik, jadi 401 TIDAK mengarahkan ke halaman login — pembeli
// yang tidak masuk memang wajar melihat katalog. Yang login-nya opsional
// diteruskan sebagai token kalau ada.

export type ApiBody<T = unknown> = {
  success: boolean;
  data?:   T;
  error?:  unknown;
  meta?:   { page: number; limit: number; total: number };
};

// Membaca body sekali sebagai teks lalu mem-parsing sendiri. `res.json()` yang
// gagal hanya memberi "Unexpected token <" tanpa menunjukkan apa yang dikirim —
// padahal justru itu petunjuknya (halaman error Cloudflare, HTML 502).
// Pesan yang dilempar IKUT ter-serialize ke dokumen HTML oleh Remix untuk
// keperluan hidrasi — artinya apa pun di sini terbaca semua pengunjung lewat
// view-source. Jadi detail teknisnya masuk log server, dan yang dilempar hanya
// kalimat netral.
//
// Ini berbeda dari panel admin, yang justru sengaja menampilkan URL dan alasan
// kegagalan: di sana pembacanya operator yang perlu mendiagnosis.
function opaqueFailure(statusText: string): Response {
  return new Response("Layanan sedang tidak tersedia.", { status: 502, statusText });
}

async function parseJson(res: Response, path: string): Promise<ApiBody> {
  const text = await res.text();
  try {
    return JSON.parse(text) as ApiBody;
  } catch {
    console.error(`[api] respons non-JSON dari ${path} (HTTP ${res.status}):`, text.slice(0, 300));
    throw opaqueFailure("Respons API tidak valid");
  }
}

function unreachable(path: string, cause: unknown): Response {
  console.error(`[api] tidak bisa menghubungi ${API_BASE}${path}:`, cause);
  return opaqueFailure("API tidak terjangkau");
}

export async function apiFetch<T = unknown>(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<ApiBody<T>> {
  const token   = getAuthToken(request);
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (cause) {
    throw unreachable(path, cause);
  }

  // 5xx dilempar ke ErrorBoundary; 4xx dikembalikan apa adanya supaya halaman
  // bisa menampilkan pesannya sendiri (stok habis, voucher tidak berlaku, dsb).
  if (res.status >= 500) {
    console.error(`[api] ${path} membalas HTTP ${res.status}`);
    throw opaqueFailure("API bermasalah");
  }

  return parseJson(res, path) as Promise<ApiBody<T>>;
}

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
