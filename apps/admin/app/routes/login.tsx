import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Form, useActionData, useNavigation } from "@remix-run/react";

import { apiPublic } from "~/lib/api";
import { STORE_URL } from "~/lib/config";
import { sessionCookie, PANEL_ROLES } from "~/lib/session";

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email    = formData.get("email") as string;
  const password = formData.get("password") as string;

  // Sengaja apiPublic, bukan apiFetch: di halaman ini 401 berarti kredensial
  // salah dan harus ditampilkan, bukan memicu pengalihan balik ke /login.
  const result = await apiPublic<{ token: string; user: { role: string } }>(
    "/api/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
  );

  if (!result.success || !result.data) {
    return json({ error: "Email atau password salah" }, { status: 401 });
  }

  // Staff kini boleh masuk panel. Sebelumnya peran ini ditolak di sini padahal
  // API meloloskannya untuk segalanya — wewenangnya hanya bisa dipakai lewat
  // panggilan API langsung, tanpa jalur yang terlihat.
  if (!PANEL_ROLES.includes(result.data.user.role)) {
    return json({ error: "Akses ditolak. Akun ini tidak punya akses panel." }, { status: 403 });
  }

  return redirect("/", {
    headers: { "Set-Cookie": sessionCookie(result.data.token) },
  });
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const nav        = useNavigation();

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <p className="text-3xl mb-2">🛒</p>
          <h1 className="text-xl font-bold text-gray-800">Admin Login</h1>
          <p className="text-sm text-gray-400">Masuk ke panel administrasi</p>
        </div>

        <Form method="post" className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Admin</label>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {actionData?.error && (
            <p className="text-red-500 text-sm">{actionData.error as string}</p>
          )}

          <button
            type="submit"
            disabled={nav.state === "submitting"}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {nav.state === "submitting" ? "Masuk..." : "Masuk"}
          </button>

          {/* Alur resetnya tinggal di storefront — tautan dari email juga ke
              sana — jadi panel menautkan ke situ alih-alih menduplikasi
              halamannya. Tanpa tautan ini, admin yang lupa password tidak punya
              petunjuk apa pun bahwa pemulihan itu ada. */}
          <a
            href={`${STORE_URL}/auth/forgot`}
            className="block text-center text-sm text-gray-400 hover:text-gray-600"
          >
            Lupa password?
          </a>
        </Form>
      </div>
    </div>
  );
}
