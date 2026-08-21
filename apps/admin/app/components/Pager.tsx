import { Link } from "@remix-run/react";

// Paginasi bersama. Daftar produk dan voucher sebelumnya mengambil limit=50
// tanpa penavigasi sama sekali — data ke-51 dan seterusnya tidak bisa dilihat
// maupun dikelola dari panel.
export function Pager({
  page, limit, total, basePath, extraParams = {}, paramName = "page", label,
}: {
  page: number;
  limit: number;
  total: number;
  basePath: string;
  extraParams?: Record<string, string>;
  /**
   * Nama parameter URL untuk nomor halaman. Halaman gudang menampilkan dua
   * daftar berpaginasi sekaligus (inventaris dan kartu stok); dengan satu nama
   * yang dipatok, menavigasi salah satunya ikut menggeser yang lain.
   */
  paramName?: string;
  /** Kata benda untuk keterangan jumlah, mis. "baris" → "Menampilkan 1–20 dari 45 baris". */
  label?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;

  const href = (p: number) => {
    const q = new URLSearchParams({ ...extraParams, [paramName]: String(p) });
    return `${basePath}?${q}`;
  };

  const from = (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-xs text-gray-400">
        Menampilkan {from}–{to} dari {total}{label ? ` ${label}` : ""}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 && (
          <Link to={href(page - 1)} className="px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50">
            ← Prev
          </Link>
        )}
        <span className="px-2 text-sm text-gray-500">{page} / {totalPages}</span>
        {page < totalPages && (
          <Link to={href(page + 1)} className="px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50">
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}
