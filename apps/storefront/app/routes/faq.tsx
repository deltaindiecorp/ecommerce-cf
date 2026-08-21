import type { MetaFunction } from "@remix-run/cloudflare";
import { StaticPage } from "~/components/StaticPage";
import { pageTitle } from "~/lib/meta";

export const meta: MetaFunction = ({ matches }) => pageTitle(matches, "FAQ");

const FAQS = [
  {
    q: "Apakah saya harus membuat akun untuk belanja?",
    a: "Tidak. Anda bisa checkout sebagai tamu (guest checkout) dengan mengisi nama, email, dan nomor HP saat pembayaran. Membuat akun opsional dan berguna untuk melihat riwayat pesanan lebih mudah.",
  },
  {
    q: "Metode pembayaran apa saja yang didukung?",
    a: "Kami mendukung transfer Virtual Account, QRIS, e-wallet (GoPay, OVO, DANA), dan kartu kredit melalui Midtrans dan Xendit.",
  },
  {
    q: "Bagaimana cara melacak pesanan saya?",
    a: "Buka halaman Lacak Paket dan masukkan nomor pesanan atau nomor resi Anda. Status pengiriman diperbarui otomatis secara berkala.",
  },
  {
    q: "Apakah saya bisa membatalkan pesanan?",
    a: "Pesanan yang belum dibayar akan otomatis dibatalkan setelah 24 jam. Untuk pembatalan pesanan yang sudah dibayar, hubungi Contact Support secepatnya sebelum pesanan diproses.",
  },
  {
    q: "Bagaimana kebijakan pengembalian/refund?",
    a: "Refund diproses ke metode pembayaran asal setelah pengajuan disetujui tim kami. Waktu pengembalian dana mengikuti kebijakan masing-masing metode pembayaran.",
  },
];

export default function FaqPage() {
  return (
    <StaticPage title="Pertanyaan yang Sering Diajukan (FAQ)">
      <div className="divide-y">
        {FAQS.map((item, i) => (
          <details key={i} className="py-3 group">
            <summary className="font-medium text-gray-800 cursor-pointer list-none flex justify-between items-center">
              {item.q}
              <span className="text-gray-400 group-open:rotate-45 transition-transform">+</span>
            </summary>
            <p className="mt-2 text-gray-600">{item.a}</p>
          </details>
        ))}
      </div>

      <p className="pt-4">
        Tidak menemukan jawaban yang Anda cari?{" "}
        <a href="/contact" className="text-blue-600 hover:underline">Hubungi kami</a>.
      </p>
    </StaticPage>
  );
}
