import type { MetaFunction } from "@remix-run/cloudflare";
import { StaticPage } from "~/components/StaticPage";
import { pageTitle } from "~/lib/meta";

export const meta: MetaFunction = ({ matches }) => pageTitle(matches, "Kebijakan Privasi");

export default function PrivacyPage() {
  return (
    <StaticPage title="Kebijakan Privasi">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-xs">
        ⚠️ Ini adalah kerangka template, <strong>bukan dokumen hukum yang sudah jadi</strong>.
        Sesuaikan dengan praktik pengolahan data Anda yang sebenarnya dan aturan yang berlaku
        (mis. UU PDP) sebelum dipakai untuk toko yang beroperasi sungguhan.
      </div>

      <div className="space-y-4 pt-2">
        <section>
          <h2 className="font-semibold text-gray-800 mb-1">1. Data yang Kami Kumpulkan</h2>
          <p>Nama, email, nomor HP, dan alamat pengiriman yang Anda berikan saat membuat akun atau checkout sebagai tamu.</p>
        </section>
        <section>
          <h2 className="font-semibold text-gray-800 mb-1">2. Penggunaan Data</h2>
          <p>Data digunakan untuk memproses pesanan, pengiriman, komunikasi terkait transaksi, dan peningkatan layanan.</p>
        </section>
        <section>
          <h2 className="font-semibold text-gray-800 mb-1">3. Berbagi Data dengan Pihak Ketiga</h2>
          <p>Data pengiriman dan pembayaran dibagikan ke mitra kurir dan payment gateway seperlunya untuk memproses transaksi Anda.</p>
        </section>
        <section>
          <h2 className="font-semibold text-gray-800 mb-1">4. Keamanan Data</h2>
          <p>Kami menerapkan praktik keamanan standar industri, termasuk enkripsi kata sandi dan pembatasan akses ke data pelanggan.</p>
        </section>
        <section>
          <h2 className="font-semibold text-gray-800 mb-1">5. Hak Anda</h2>
          <p>Anda dapat meminta akses, koreksi, atau penghapusan data pribadi Anda dengan menghubungi Contact Support.</p>
        </section>
      </div>
    </StaticPage>
  );
}
