import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Form, useActionData, useNavigation, Link , useRouteLoaderData } from "@remix-run/react";

import type { loader as rootLoader } from "~/root";
import { apiFetch, formatApiError } from "~/lib/api";
import { authCookie } from "~/lib/session";

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email    = formData.get("email") as string;
  const password = formData.get("password") as string;

  const result = await apiFetch<any>(request, "/api/auth/login", {
    method: "POST",
    body:   JSON.stringify({ email, password }),
  });
  if (!result.success) return json({ error: result.error }, { status: 400 });

  const token = result.data.token;
  const redirectTo = new URL(request.url).searchParams.get("redirect") ?? "/";

  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": authCookie(token),
    },
  });
}

export default function LoginPage() {
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
          <h1 className="text-xl font-semibold mt-3 text-gray-800">Masuk ke Akun</h1>
        </div>

        <Form method="post" className="space-y-4">
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Minimal 8 karakter"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {Boolean(actionData?.error) && (
            <p className="text-red-500 text-sm">{formatApiError(actionData?.error)}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isLoading ? "Memproses..." : "Masuk"}
          </button>
          <Link to="/auth/forgot" className="block text-center text-sm text-gray-500 hover:text-gray-700">
            Lupa password?
          </Link>
        </Form>

        <p className="text-center text-sm text-gray-500 mt-6">
          Belum punya akun?{" "}
          <Link to="/auth/register" className="text-blue-600 font-medium hover:underline">
            Daftar
          </Link>
        </p>
      </div>
    </div>
  );
}
