import type { MetaFunction } from "@remix-run/cloudflare";
import { StaticPage } from "~/components/StaticPage";

export const meta: MetaFunction = () => [{ title: "Contact Support - Deltacommerce" }];

export default function ContactPage() {
  return (
    <StaticPage title="Contact Support">
      <p>Tim kami siap membantu Anda untuk pertanyaan seputar pesanan, pembayaran, maupun produk.</p>

      <div className="grid sm:grid-cols-2 gap-4 pt-2">
        <div className="border rounded-lg p-4">
          <p className="font-semibold text-gray-800 mb-1">📧 Email</p>
          <p>support@your-store.com</p>
          <p className="text-xs text-gray-400 mt-1">Balasan dalam 1x24 jam kerja</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="font-semibold text-gray-800 mb-1">💬 WhatsApp</p>
          <p>0812-3456-7890</p>
          <p className="text-xs text-gray-400 mt-1">Senin–Sabtu, 09.00–17.00 WIB</p>
        </div>
      </div>

      <p className="pt-2">
        Sebelum menghubungi kami, cek dulu jawaban cepat di halaman{" "}
        <a href="/faq" className="text-blue-600 hover:underline">FAQ</a> — mungkin pertanyaan Anda sudah terjawab di sana.
      </p>
    </StaticPage>
  );
}
