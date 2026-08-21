import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";

import { apiFetch, formatApiError } from "~/lib/api";
import { isAdminRole, useAdminRole } from "~/lib/session";
import { Pager } from "~/components/Pager";

const FIELD = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const LABEL = "block text-xs font-medium text-gray-500 mb-1";
const PAGE_SIZE = 20;

const ROLE_LABEL: Record<string, string> = { admin: "Admin", staff: "Staff", customer: "Pelanggan" };
const ROLE_COLOR: Record<string, string> = {
  admin:    "bg-purple-100 text-purple-700",
  staff:    "bg-blue-100 text-blue-700",
  customer: "bg-gray-100 text-gray-600",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url  = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? 1);
  const role = url.searchParams.get("role") ?? "";

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (role) params.set("role", role);

  const body = await apiFetch<any[]>(request, `/api/admin/users?${params}`);
  return json({
    users: body.data ?? [],
    meta:  body.meta ?? { page, limit: PAGE_SIZE, total: 0 },
    role,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const fd     = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  if (intent === "create") {
    const result = await apiFetch(request, "/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        name:     String(fd.get("name") ?? ""),
        email:    String(fd.get("email") ?? ""),
        phone:    String(fd.get("phone") ?? ""),
        password: String(fd.get("password") ?? ""),
        role:     String(fd.get("role") ?? "staff"),
      }),
    });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return redirect("/users");
  }

  if (intent === "set_role") {
    const id     = String(fd.get("id") ?? "");
    const result = await apiFetch(request, `/api/admin/users/${id}`, {
      method: "PATCH",
      body:   JSON.stringify({ role: String(fd.get("role") ?? "") }),
    });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return redirect("/users");
  }

  return json({ error: "Intent tidak dikenal" }, { status: 400 });
}

export default function UsersPage() {
  const { users, meta, role } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav        = useNavigation();
  const saving     = nav.state === "submitting";
  const isAdmin    = isAdminRole(useAdminRole());

  if (!isAdmin) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Kelola Pengguna</h1>
        <p className="text-sm text-gray-500">Halaman ini hanya untuk admin.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Kelola Pengguna</h1>
        <p className="text-sm text-gray-400">{meta.total} akun</p>
      </div>

      {Boolean(actionData?.error) && (
        <pre className="mb-4 text-xs bg-red-50 text-red-700 border border-red-100 rounded-lg px-4 py-2.5 whitespace-pre-wrap">
          {formatApiError(actionData?.error)}
        </pre>
      )}

      {/* Tambah akun */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="font-semibold text-gray-700 mb-1">Tambah Akun</h2>
        <p className="text-xs text-gray-400 mb-4">
          Akun staff bisa mengelola pesanan dan stok, tapi tidak bisa refund,
          menghapus, atau mengubah gudang dan voucher.
        </p>
        <Form method="post" className="grid grid-cols-12 gap-3 items-end">
          <input type="hidden" name="intent" value="create" />
          <div className="col-span-3">
            <label className={LABEL}>Nama</label>
            <input name="name" required minLength={2} className={FIELD} />
          </div>
          <div className="col-span-3">
            <label className={LABEL}>Email</label>
            <input name="email" type="email" required className={FIELD} />
          </div>
          <div className="col-span-2">
            <label className={LABEL}>No. HP</label>
            <input name="phone" required placeholder="08..." className={FIELD} />
          </div>
          <div className="col-span-2">
            <label className={LABEL}>Password Awal</label>
            <input name="password" type="password" required minLength={8} className={FIELD} />
          </div>
          <div className="col-span-1">
            <label className={LABEL}>Peran</label>
            <select name="role" defaultValue="staff" className={FIELD}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="col-span-1">
            <button type="submit" disabled={saving}
              className="w-full bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50">
              Tambah
            </button>
          </div>
        </Form>
        <p className="text-[11px] text-gray-400 mt-3">
          Password awal ini hanya untuk masuk pertama kali — beri tahu pemiliknya
          agar segera menggantinya lewat &ldquo;Lupa password&rdquo; di halaman toko.
        </p>
      </div>

      {/* Filter peran */}
      <div className="flex gap-2 mb-4">
        {["", "admin", "staff", "customer"].map(r => (
          <a key={r} href={`/users${r ? `?role=${r}` : ""}`}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              role === r ? "bg-blue-600 text-white border-blue-600" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>
            {r ? ROLE_LABEL[r] : "Semua"}
          </a>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[46rem]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Nama</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Kontak</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Peran</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Ubah Peran</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-10 text-gray-400">Tidak ada akun</td></tr>
              ) : (
                users.map((u: any) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-800">{u.name ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">
                      <p className="text-xs">{u.email}</p>
                      <p className="text-xs text-gray-400">{u.phone ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLOR[u.role] ?? "bg-gray-100"}`}>
                        {ROLE_LABEL[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Form method="post" className="flex items-center gap-2">
                        <input type="hidden" name="intent" value="set_role" />
                        <input type="hidden" name="id" value={u.id} />
                        <select name="role" defaultValue={u.role}
                          className="border border-gray-200 rounded px-2 py-1 text-xs">
                          <option value="admin">Admin</option>
                          <option value="staff">Staff</option>
                          <option value="customer">Pelanggan</option>
                        </select>
                        <button type="submit" disabled={saving}
                          className="bg-gray-800 text-white px-2.5 py-1 rounded text-xs font-medium hover:bg-gray-900 disabled:opacity-50">
                          Simpan
                        </button>
                      </Form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pager page={meta.page} limit={meta.limit} total={meta.total} basePath="/users"
        extraParams={role ? { role } : {}} />
    </div>
  );
}
