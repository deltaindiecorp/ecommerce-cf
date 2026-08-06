import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { Form, useActionData, useNavigation } from "@remix-run/react";

import { API_BASE } from "~/lib/config";

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email    = formData.get("email") as string;
  const password = formData.get("password") as string;

  const res  = await fetch(`${API_BASE}/api/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, password }),
  });

  const result = await res.json() as any;
  if (!result.success) return json({ error: "Email atau password salah" }, { status: 401 });

  if (result.data.user.role !== "admin") {
    return json({ error: "Akses ditolak. Bukan akun admin." }, { status: 403 });
  }

  return redirect("/", {
    headers: {
      "Set-Cookie": `admin_token=${result.data.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
    },
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
        </Form>
      </div>
    </div>
  );
}
