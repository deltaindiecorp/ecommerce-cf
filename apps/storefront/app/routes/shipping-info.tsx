import type { MetaFunction } from "@remix-run/cloudflare";
import { StaticPage } from "~/components/StaticPage";

export const meta: MetaFunction = () => [{ title: "Info Pengiriman - Deltacommerce" }];

export default function ShippingInfoPage() {
  return (
    <StaticPage title="Info Pengiriman">
      <p>
        Ongkos kirim dihitung otomatis saat checkout berdasarkan alamat tujuan, berat produk, dan
        kurir yang Anda pilih — didukung oleh RajaOngkir untuk estimasi biaya dan waktu pengiriman
        yang akurat.
      </p>

      <div>
        <p className="font-semibold text-gray-800 mb-2">Kurir yang Tersedia</p>
        <ul className="list-disc list-inside space-y-1">
          <li>JNE</li>
          <li>J&amp;T Express</li>
          <li>SiCepat</li>
          <li>Pos Indonesia</li>
          <li>TIKI</li>
        </ul>
      </div>

      <div>
        <p className="font-semibold text-gray-800 mb-2">Lacak Pesanan</p>
        <p>
          Setelah pesanan dikirim, Anda akan menerima nomor resi lewat email. Lacak status
          pengiriman kapan saja di halaman{" "}
          <a href="/track" className="text-blue-600 hover:underline">Lacak Paket</a>.
        </p>
      </div>

      <p className="text-xs text-gray-400 pt-2">
        Estimasi waktu pengiriman bervariasi tergantung lokasi dan layanan kurir yang dipilih.
      </p>
    </StaticPage>
  );
}
