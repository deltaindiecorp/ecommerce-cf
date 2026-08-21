import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";

import { apiFetch, formatApiError } from "~/lib/api";
import { isAdminRole, useAdminRole } from "~/lib/session";

const FIELD = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const LABEL = "block text-xs font-medium text-gray-500 mb-1";

function optText(fd: FormData, key: string): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : v;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const body = await apiFetch<any>(request, "/api/settings");
  return json({ settings: body.data ?? null });
}

export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();

  const result = await apiFetch(request, "/api/admin/settings", {
    method: "PATCH",
    body: JSON.stringify({
      storeName:    String(fd.get("storeName") ?? "").trim(),
      tagline:      optText(fd, "tagline"),
      supportEmail: optText(fd, "supportEmail"),
      supportPhone: optText(fd, "supportPhone"),
      address:      optText(fd, "address"),
    }),
  });

  if (!result.success) return json({ ok: false, error: result.error }, { status: 400 });
  return json({ ok: true, error: null });
}

export default function SettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData   = useActionData<typeof action>();
  const nav          = useNavigation();
  const saving       = nav.state === "submitting";
  const isAdmin      = isAdminRole(useAdminRole());

  if (!isAdmin) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Pengaturan Toko</h1>
        <p className="text-sm text-gray-500">Halaman ini hanya untuk admin.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Pengaturan Toko</h1>
      <p className="text-sm text-gray-500 mb-6">
        Identitas yang tampil di storefront — nama toko, deskripsi singkat, dan kontak.
      </p>

      {actionData?.ok && (
        <p className="mb-4 text-sm bg-green-50 text-green-700 border border-green-100 rounded-lg px-4 py-2.5">
          Tersimpan. Storefront menampilkan perubahannya dalam beberapa saat.
        </p>
      )}
      {Boolean(actionData?.error) && (
        <pre className="mb-4 text-xs bg-red-50 text-red-700 border border-red-100 rounded-lg px-4 py-2.5 whitespace-pre-wrap">
          {formatApiError(actionData?.error)}
        </pre>
      )}

      <Form method="post" className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label className={LABEL}>Nama Toko</label>
          <input name="storeName" required maxLength={60} defaultValue={settings?.storeName ?? ""} className={FIELD} />
          <p className="text-[11px] text-gray-400 mt-1">
            Tampil di header, footer, dan judul setiap halaman storefront.
          </p>
        </div>

        <div>
          <label className={LABEL}>Deskripsi Singkat</label>
          <textarea name="tagline" rows={2} maxLength={200} defaultValue={settings?.tagline ?? ""} className={FIELD} />
          <p className="text-[11px] text-gray-400 mt-1">Muncul di footer, di bawah nama toko.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Email Dukungan</label>
            <input name="supportEmail" type="email" defaultValue={settings?.supportEmail ?? ""} className={FIELD} />
          </div>
          <div>
            <label className={LABEL}>Telepon Dukungan</label>
            <input name="supportPhone" defaultValue={settings?.supportPhone ?? ""} className={FIELD} />
          </div>
        </div>

        <div>
          <label className={LABEL}>Alamat</label>
          <textarea name="address" rows={2} maxLength={300} defaultValue={settings?.address ?? ""} className={FIELD} />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Menyimpan..." : "Simpan Pengaturan"}
        </button>
      </Form>
    </div>
  );
}
