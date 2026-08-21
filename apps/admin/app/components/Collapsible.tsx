import type { ReactNode } from "react";

// ─── Panel yang bisa dilipat ──────────────────────────────────────────────────
// Halaman admin sebelumnya menumpuk semua form pembuatan di atas daftarnya,
// sehingga tiap kunjungan disambut form kosong yang panjang dan daftar yang
// seharusnya jadi isi utama justru terdorong ke bawah lipatan layar.
//
// Memakai <details> bawaan browser, bukan state React: panel ini muncul di
// halaman yang dirender server, jadi ia harus sudah bisa dibuka-tutup sebelum
// JavaScript-nya selesai dimuat.
export function Collapsible({
  title,
  children,
  summary,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  /** Keterangan singkat di sebelah judul saat panel tertutup. */
  summary?: string;
  /**
   * Dibuka saat render pertama. Dipakai untuk membuka kembali form yang
   * submit-nya ditolak — kalau tidak, pesan errornya ikut tersembunyi dan
   * form seolah tidak melakukan apa-apa.
   */
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group bg-white rounded-xl shadow-sm mb-6">
      <summary className="flex cursor-pointer select-none items-center gap-3 px-6 py-4 text-sm font-semibold text-gray-700 marker:content-none [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gray-100 text-gray-500 transition-transform group-open:rotate-45"
        >
          +
        </span>
        <span>{title}</span>
        {summary && <span className="font-normal text-gray-400 group-open:hidden">{summary}</span>}
      </summary>
      <div className="border-t border-gray-100 px-6 py-5">{children}</div>
    </details>
  );
}
