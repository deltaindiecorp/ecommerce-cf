import type { MetaFunction } from "@remix-run/cloudflare";
import { StaticPage } from "~/components/StaticPage";
import { useRouteLoaderData } from "@remix-run/react";
import type { loader as rootLoader } from "~/root";
import { pageTitle, FALLBACK_STORE_NAME } from "~/lib/meta";

export const meta: MetaFunction = ({ matches }) => pageTitle(matches, "Tentang Kami");

export default function AboutPage() {
  const rootData  = useRouteLoaderData<typeof rootLoader>("root");
  const storeName = rootData?.store?.storeName ?? FALLBACK_STORE_NAME;

  return (
    <StaticPage title="Tentang Kami">
      <p>
        {storeName} adalah platform belanja online yang menghadirkan produk pilihan berkualitas dengan
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
