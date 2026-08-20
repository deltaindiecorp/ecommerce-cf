import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, Link } from "@remix-run/react";
import { useEffect } from "react";

import { API_BASE } from "~/lib/config";
import { apiFetch } from "~/lib/api";
import { nextPaymentStep, isSafePaymentUrl, type PaymentStep } from "~/lib/payment";

export async function loader({ request }: LoaderFunctionArgs) {
  const url     = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  if (!orderId) return redirect("/");

  // Panggilan ke /api/admin/orders sengaja dihapus: hasilnya tidak pernah
  // dipakai, dan halaman publik tidak punya alasan menembak endpoint admin.
  const ambilStatus = async () =>
    (await apiFetch<any>(request, `/api/payment/${orderId}/status`).catch(() => null))?.data ?? null;

  let snapshot   = await ambilStatus();
  let baruDibuat = false;
  let gagalBuat  = false;

  if (!snapshot) {
    // Inilah panggilan yang selama ini TIDAK PERNAH terjadi. POST
    // /api/payment/create sudah lengkap di server sejak awal, tapi checkout cuma
    // menyebutnya sebagai `nextStep` dalam responsnya — petunjuk teks yang tidak
    // ada yang menindaklanjuti. Akibatnya pembeli tidak pernah sampai ke
    // Midtrans/Xendit dan pesanannya menggantung "pending" selamanya.
    const dibuat = await apiFetch<any>(request, "/api/payment/create", {
      method: "POST",
      body:   JSON.stringify({ orderId }),
    }).catch(() => null);

    if (dibuat?.success) {
      baruDibuat = true;
      snapshot = {
        status:     "pending",
        gateway:    dibuat.data.gateway ?? null,
        paymentUrl: dibuat.data.snapRedirectUrl ?? dibuat.data.invoiceUrl ?? null,
      };
    } else {
      // Mungkin pembayaran baru saja dibuat di tab lain (409). Diambil ulang
      // sebelum menyerah, supaya pembeli tidak melihat kegagalan padahal
      // tagihannya sudah ada.
      snapshot  = await ambilStatus();
      gagalBuat = !snapshot;
    }
  }

  const step = nextPaymentStep(snapshot, baruDibuat);

  // Dialihkan dari server: pembeli langsung mendarat di halaman bayar tanpa
  // sempat melihat layar antara yang membingungkan.
  if (step.kind === "redirect" && isSafePaymentUrl(step.url)) return redirect(step.url);

  // URL yang tidak lolos pemeriksaan tidak dibuang diam-diam — tanpa catatan
  // ini, pembeli melihat layar tunggu tanpa tombol bayar dan tidak ada yang tahu
  // sebabnya.
  if (step.kind === "redirect") {
    console.error(`[payment] URL bayar ditolak pemeriksaan domain: ${step.url}`);
  }

  const lanjut = step.kind === "wait" && isSafePaymentUrl(step.url) ? step.url : null;

  return json({ orderId, step, lanjut, gagalBuat });
}

export default function PaymentPage() {
  const { orderId, step, lanjut, gagalBuat } = useLoaderData<typeof loader>();
  const s = step as PaymentStep;

  // Webhook yang menandai lunas datang ke server, bukan ke browser ini — jadi
  // halaman menanyakannya berkala.
  useEffect(() => {
    if (s.kind === "paid" || s.kind === "closed") return;
    const interval = setInterval(async () => {
      const res  = await fetch(`${API_BASE}/api/payment/${orderId}/status`);
      const body = await res.json() as any;
      if (body.data?.status === "paid") window.location.href = `/orders/${orderId}`;
    }, 5000);
    return () => clearInterval(interval);
  }, [orderId, s.kind]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow p-8 max-w-md w-full text-center">
        {s.kind === "paid" ? (
          <>
            <div className="text-5xl mb-4">✅</div>
            <h1 className="text-2xl font-bold text-green-600 mb-2">Pembayaran Berhasil!</h1>
            <p className="text-gray-600 mb-6">Pesanan Anda sedang kami proses.</p>
            <Link to={`/orders/${orderId}`} className="inline-block bg-blue-600 text-white px-6 py-3 rounded-xl font-medium">
              Lihat Status Pesanan
            </Link>
          </>
        ) : s.kind === "cod" ? (
          <>
            <div className="text-5xl mb-4">📦</div>
            <h1 className="text-xl font-bold mb-2">Bayar di Tempat</h1>
            <p className="text-gray-600 text-sm mb-6">
              Siapkan uang tunai sejumlah total pesanan saat kurir tiba. Tidak ada
              yang perlu dibayar sekarang.
            </p>
            <Link to={`/orders/${orderId}`} className="inline-block bg-blue-600 text-white px-6 py-3 rounded-xl font-medium">
              Lihat Pesanan
            </Link>
          </>
        ) : s.kind === "closed" ? (
          <>
            <div className="text-5xl mb-4">⌛</div>
            <h1 className="text-xl font-bold mb-2">Pembayaran Tidak Bisa Dilanjutkan</h1>
            <p className="text-gray-600 text-sm mb-6">
              Status pembayaran: <span className="font-medium">{s.status}</span>. Silakan
              buat pesanan baru, atau hubungi kami kalau ini keliru.
            </p>
            <div className="flex gap-3">
              <Link to="/" className="flex-1 border text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Beranda</Link>
              <Link to={`/orders/${orderId}`} className="flex-1 border text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">Lihat Pesanan</Link>
            </div>
          </>
        ) : (
          <>
            <div className="text-5xl mb-4">⏳</div>
            <h1 className="text-xl font-bold mb-2">Menunggu Pembayaran</h1>

            {gagalBuat ? (
              <p className="text-sm text-red-600 mb-6">
                Halaman pembayaran belum bisa dibuka. Coba muat ulang; kalau tetap
                gagal, hubungi kami dengan menyebut nomor pesanan di bawah.
              </p>
            ) : (
              <p className="text-gray-600 text-sm mb-6">
                Selesaikan pembayaran Anda. Halaman ini otomatis diperbarui setelah
                pembayaran dikonfirmasi.
              </p>
            )}

            {/* Jalan kembali untuk pembeli yang menutup tab. Sebelum kolom
                payment_url ada, alamat bayar hilang setelah dipakai sekali dan
                pesanan yang sah jadi buntu sampai kedaluwarsa 24 jam. */}
            {lanjut && (
              <a href={lanjut} className="block bg-blue-600 text-white py-3 rounded-xl font-medium mb-6 hover:bg-blue-700">
                Lanjutkan Pembayaran
              </a>
            )}

            <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
              <p className="text-xs text-gray-500 mb-1">Nomor Pesanan</p>
              <p className="text-sm font-mono font-medium break-all">{orderId}</p>
            </div>

            <div className="flex items-center justify-center gap-2 text-gray-400 text-sm mb-6">
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              Memeriksa status pembayaran...
            </div>

            <div className="flex gap-3">
              <Link to="/" className="flex-1 border text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">
                Lanjut Belanja
              </Link>
              <Link to={`/track?orderId=${orderId}`} className="flex-1 border text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50">
                Cek Status
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
