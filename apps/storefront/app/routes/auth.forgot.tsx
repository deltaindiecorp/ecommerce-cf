import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { Form, useActionData, useNavigation, Link, useRouteLoaderData } from "@remix-run/react";
import type { loader as rootLoader } from "~/root";

import { apiFetch } from "~/lib/api";

export async function action({ request }: ActionFunctionArgs) {
  const fd    = await request.formData();
  const email = String(fd.get("email") ?? "").trim();

  const result = await apiFetch<any>(request, "/api/auth/forgot-password", {
    method: "POST",
    body:   JSON.stringify({ email }),
  });

  // API sengaja selalu membalas sukses supaya halaman ini tidak bisa dipakai
  // memeriksa email mana yang punya akun. Pesannya pun dibuat netral.
  return json({ sent: result.success });
}

export default function ForgotPasswordPage() {
  const actionData = useActionData<typeof action>();
  const nav        = useNavigation();
  const rootData   = useRouteLoaderData<typeof rootLoader>("root");
  const storeName  = rootData?.store?.storeName ?? "Deltacommerce";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <Link to="/" className="text-2xl font-bold text-blue-600">{storeName}</Link>
          <h1 className="text-lg font-bold text-gray-800 mt-4">Lupa Password</h1>
          <p className="text-sm text-gray-500 mt-1">
            Masukkan email akun Anda. Kami kirimkan tautan untuk menyetel password baru.
          </p>
        </div>

        {actionData?.sent ? (
          <div className="text-center">
            <p className="text-3xl mb-3">📬</p>
            <p className="text-sm text-gray-700">
              Kalau email tersebut terdaftar, tautan reset sudah dikirim. Tautannya
              berlaku 30 menit.
            </p>
            <p className="text-xs text-gray-400 mt-3">Cek juga folder spam.</p>
            <Link to="/auth/login" className="inline-block mt-6 text-sm text-blue-600 hover:underline">
              Kembali ke halaman masuk
            </Link>
          </div>
        ) : (
          <Form method="post" className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                name="email" type="email" required autoComplete="email"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit" disabled={nav.state === "submitting"}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {nav.state === "submitting" ? "Mengirim..." : "Kirim Tautan Reset"}
            </button>
            <Link to="/auth/login" className="block text-center text-sm text-gray-500 hover:text-gray-700">
              Kembali ke halaman masuk
            </Link>
          </Form>
        )}
      </div>
    </div>
  );
}
