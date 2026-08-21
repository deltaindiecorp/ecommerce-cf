import type { MetaFunction } from "@remix-run/cloudflare";
import { StaticPage } from "~/components/StaticPage";
import { pageTitle } from "~/lib/meta";

export const meta: MetaFunction = ({ matches }) => pageTitle(matches, "Karir");

export default function CareersPage() {
  return (
    <StaticPage title="Karir">
      <p>
        Saat ini belum ada lowongan yang dibuka. Pantau halaman ini secara berkala, atau kirim CV
        Anda ke email di bawah untuk dipertimbangkan pada kesempatan mendatang.
      </p>
      <div className="border rounded-lg p-4 mt-2">
        <p className="font-semibold text-gray-800 mb-1">📧 Email Rekrutmen</p>
        <p>karir@your-store.com</p>
      </div>
      <p className="text-xs text-gray-400 pt-2">
        Halaman ini adalah konten placeholder — ganti dengan daftar lowongan Anda yang sebenarnya.
      </p>
    </StaticPage>
  );
}
