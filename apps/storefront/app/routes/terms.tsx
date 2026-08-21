import type { MetaFunction } from "@remix-run/cloudflare";
import { StaticPage } from "~/components/StaticPage";
import { pageTitle } from "~/lib/meta";

export const meta: MetaFunction = ({ matches }) => pageTitle(matches, "Syarat & Ketentuan");

export default function TermsPage() {
  return (
    <StaticPage title="Syarat & Ketentuan">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-xs">
        ⚠️ Ini adalah kerangka template, <strong>bukan dokumen hukum yang sudah jadi</strong>.
        Konsultasikan dengan penasihat hukum sebelum dipakai untuk toko yang beroperasi sungguhan.
      </div>

      <div className="space-y-4 pt-2">
        <section>
          <h2 className="font-semibold text-gray-800 mb-1">1. Penerimaan Ketentuan</h2>
          <p>Dengan menggunakan layanan ini, Anda setuju untuk terikat oleh syarat dan ketentuan berikut.</p>
        </section>
        <section>
          <h2 className="font-semibold text-gray-800 mb-1">2. Pemesanan & Pembayaran</h2>
          <p>Pesanan dianggap sah setelah pembayaran dikonfirmasi melalui metode pembayaran yang tersedia. Harga dapat berubah sewaktu-waktu tanpa pemberitahuan sebelumnya.</p>
        </section>
        <section>
          <h2 className="font-semibold text-gray-800 mb-1">3. Pengiriman</h2>
          <p>Estimasi waktu pengiriman bersifat perkiraan dan dapat dipengaruhi oleh faktor di luar kendali kami, termasuk kondisi kurir dan lokasi tujuan.</p>
        </section>
        <section>
          <h2 className="font-semibold text-gray-800 mb-1">4. Pengembalian & Refund</h2>
          <p>Kebijakan pengembalian mengikuti ketentuan yang berlaku dan dapat berbeda tergantung kondisi produk serta metode pembayaran.</p>
        </section>
        <section>
          <h2 className="font-semibold text-gray-800 mb-1">5. Perubahan Ketentuan</h2>
          <p>Kami berhak mengubah syarat dan ketentuan ini sewaktu-waktu. Perubahan berlaku sejak dipublikasikan di halaman ini.</p>
        </section>
      </div>
    </StaticPage>
  );
}
