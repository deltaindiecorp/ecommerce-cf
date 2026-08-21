import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { Form, useActionData, useLoaderData, useNavigation, Link, useRouteLoaderData } from "@remix-run/react";
import type { loader as rootLoader } from "~/root";

import { apiFetch, formatApiError } from "~/lib/api";

export async function loader({ request }: LoaderFunctionArgs) {
  // Token hanya diteruskan ke form; keabsahannya baru diuji saat ditukar.
  // Memeriksanya di sini akan membocorkan token valid lewat log/referrer tanpa
  // menambah keamanan apa pun.
  return json({ token: new URL(request.url).searchParams.get("token") ?? "" });
}

export async function action({ request }: ActionFunctionArgs) {
  const fd       = await request.formData();
  const password = String(fd.get("password") ?? "");
  const confirm  = String(fd.get("confirm") ?? "");

  if (password !== confirm) {
    return json({ ok: false, error: "Password dan konfirmasi tidak sama" }, { status: 400 });
  }

  const result = await apiFetch<any>(request, "/api/auth/reset-password", {
    method: "POST",
    body:   JSON.stringify({ token: String(fd.get("token") ?? ""), password }),
  });

  if (!result.success) return json({ ok: false, error: result.error }, { status: 400 });
  return json({ ok: true, error: null });
}

export default function ResetPasswordPage() {
  const { token }  = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav        = useNavigation();
  const rootData   = useRouteLoaderData<typeof rootLoader>("root");
  const storeName  = rootData?.store?.storeName ?? "Deltacommerce";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <Link to="/" className="text-2xl font-bold text-blue-600">{storeName}</Link>
          <h1 className="text-lg font-bold text-gray-800 mt-4">Setel Password Baru</h1>
        </div>

        {actionData?.ok ? (
          <div className="text-center">
            <p className="text-3xl mb-3">✅</p>
            <p className="text-sm text-gray-700">Password berhasil diubah.</p>
            <Link
              to="/auth/login"
              className="inline-block mt-6 bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              Masuk Sekarang
            </Link>
          </div>
        ) : !token ? (
          <p className="text-sm text-gray-600 text-center">
            Tautan tidak lengkap. Buka kembali tautan dari email, atau{" "}
            <Link to="/auth/forgot" className="text-blue-600 hover:underline">minta tautan baru</Link>.
          </p>
        ) : (
          <Form method="post" className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password Baru</label>
              <input
                name="password" type="password" required minLength={8} autoComplete="new-password"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-gray-400 mt-1">Minimal 8 karakter.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ulangi Password Baru</label>
              <input
                name="confirm" type="password" required minLength={8} autoComplete="new-password"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {Boolean(actionData?.error) && (
              <p className="text-red-500 text-sm whitespace-pre-wrap">{formatApiError(actionData?.error)}</p>
            )}

            <button
              type="submit" disabled={nav.state === "submitting"}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {nav.state === "submitting" ? "Menyimpan..." : "Simpan Password Baru"}
            </button>
          </Form>
        )}
      </div>
    </div>
  );
}
