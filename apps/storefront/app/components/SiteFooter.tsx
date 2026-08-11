import { Link, useRouteLoaderData } from "@remix-run/react";
import type { loader as rootLoader } from "~/root";

export function SiteFooter() {
  const rootData = useRouteLoaderData<typeof rootLoader>("root");
  const store     = rootData?.store;
  const storeName = store?.storeName ?? "Deltacommerce";

  return (
    <footer className="w-full border-t bg-white mt-10">
      <div className="max-w-6xl mx-auto px-4 py-10 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2 md:col-span-1">
          <h3 className="font-bold text-blue-600 mb-2">{storeName}</h3>
          <p className="text-sm text-gray-500">
            {store?.tagline ?? "Platform belanja online terpercaya untuk kebutuhan harian Anda dengan harga terbaik."}
          </p>
          {(store?.supportEmail || store?.supportPhone) && (
            <p className="text-xs text-gray-400 mt-3 space-x-2">
              {store.supportEmail && <span>{store.supportEmail}</span>}
              {store.supportPhone && <span>{store.supportPhone}</span>}
            </p>
          )}
        </div>
        <div>
          <h4 className="font-semibold text-gray-800 mb-2 text-sm">Layanan Pelanggan</h4>
          <ul className="space-y-1.5 text-sm text-gray-500">
            <li><Link to="/contact" className="hover:text-blue-600 hover:underline">Contact Support</Link></li>
            <li><Link to="/shipping-info" className="hover:text-blue-600 hover:underline">Info Pengiriman</Link></li>
            <li><Link to="/faq" className="hover:text-blue-600 hover:underline">FAQ</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold text-gray-800 mb-2 text-sm">Perusahaan</h4>
          <ul className="space-y-1.5 text-sm text-gray-500">
            <li><Link to="/about" className="hover:text-blue-600 hover:underline">Tentang Kami</Link></li>
            <li><Link to="/careers" className="hover:text-blue-600 hover:underline">Karir</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold text-gray-800 mb-2 text-sm">Kebijakan</h4>
          <ul className="space-y-1.5 text-sm text-gray-500">
            <li><Link to="/terms" className="hover:text-blue-600 hover:underline">Syarat & Ketentuan</Link></li>
            <li><Link to="/privacy" className="hover:text-blue-600 hover:underline">Kebijakan Privasi</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t py-4 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} {storeName}. Seluruh hak cipta dilindungi.
      </div>
    </footer>
  );
}
