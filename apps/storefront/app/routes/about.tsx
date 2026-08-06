import type { MetaFunction } from "@remix-run/cloudflare";
import { StaticPage } from "~/components/StaticPage";

export const meta: MetaFunction = () => [{ title: "Tentang Kami - Deltacommerce" }];

export default function AboutPage() {
  return (
    <StaticPage title="Tentang Kami">
      <p>
        Deltacommerce adalah platform belanja online yang menghadirkan produk pilihan berkualitas dengan
        harga bersaing, langsung ke tangan Anda dengan proses yang cepat dan aman.
      </p>
      <p>
        Kami berkomitmen memberikan pengalaman berbelanja yang mudah — mulai dari pilihan produk,
        proses checkout, hingga pengiriman yang bisa dilacak secara real-time.
      </p>
      <p className="text-xs text-gray-400 pt-2">
        Halaman ini adalah konten placeholder — ganti dengan profil perusahaan Anda yang sebenarnya.
      </p>
    </StaticPage>
  );
}
