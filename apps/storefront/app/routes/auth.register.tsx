import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Form, useActionData, useNavigation, Link , useRouteLoaderData } from "@remix-run/react";

import type { loader as rootLoader } from "~/root";
import { apiFetch, formatApiError } from "~/lib/api";
import { authCookie } from "~/lib/session";

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const name     = formData.get("name") as string;
  const email    = formData.get("email") as string;
  const phone    = formData.get("phone") as string;
  const password = formData.get("password") as string;
  const confirm  = formData.get("confirm") as string;

  if (password !== confirm) {
    return json({ error: "Password dan konfirmasi tidak cocok" }, { status: 400 });
  }

  const result = await apiFetch<any>(request, "/api/auth/register", {
    method: "POST",
    body:   JSON.stringify({ name, email, phone, password }),
  });

  if (!result.success) {
    // Hasil zod .flatten() diterjemahkan jadi "field: pesan" alih-alih JSON
    // mentah; pesan string dari API tetap dipakai apa adanya.
    return json({ error: formatApiError(result.error) || "Registrasi gagal, periksa kembali data Anda" }, { status: 400 });
  }

  const token = result.data.token;
  return redirect("/", {
    headers: {
      "Set-Cookie": authCookie(token),
    },
  });
}

export default function RegisterPage() {
  const rootData  = useRouteLoaderData<typeof rootLoader>("root");
  const storeName = rootData?.store?.storeName ?? "Deltacommerce";
  const actionData = useActionData<typeof action>();
  const nav        = useNavigation();
  const isLoading  = nav.state === "submitting";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <Link to="/" className="text-2xl font-bold text-blue-600">{storeName}</Link>
          <h1 className="text-xl font-semibold mt-3 text-gray-800">Buat Akun Baru</h1>
        </div>

        <Form method="post" className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nama Lengkap</label>
            <input
              name="name"
              required
              minLength={2}
              placeholder="Nama lengkap Anda"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="email@contoh.com"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nomor HP</label>
            <input
              name="phone"
              type="tel"
              required
              placeholder="08xxxxxxxxxx"
              pattern="^(\+62|62|0)[0-9]{8,12}$"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Minimal 8 karakter"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Konfirmasi Password</label>
            <input
              name="confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Ulangi password"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {actionData?.error && (
            <p className="text-red-500 text-sm">{actionData.error as string}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isLoading ? "Mendaftar..." : "Daftar"}
          </button>
        </Form>

        <p className="text-center text-sm text-gray-500 mt-6">
          Sudah punya akun?{" "}
          <Link to="/auth/login" className="text-blue-600 font-medium hover:underline">
            Masuk
          </Link>
        </p>
      </div>
    </div>
  );
}
