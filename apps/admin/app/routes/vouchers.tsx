import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";

import { apiFetch, formatApiError } from "~/lib/api";

export async function loader({ request }: LoaderFunctionArgs) {
  const body = await apiFetch<any[]>(request, "/api/admin/vouchers?limit=50");
  return json({ vouchers: body.data ?? [] });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent   = formData.get("intent") as string;

  if (intent === "create") {
    const payload = {
      code:        formData.get("code"),
      type:        formData.get("type"),
      value:       Number(formData.get("value")),
      minPurchase: Number(formData.get("minPurchase") || 0),
      maxDiscount: formData.get("maxDiscount") ? Number(formData.get("maxDiscount")) : undefined,
      usageLimit:  formData.get("usageLimit") ? Number(formData.get("usageLimit")) : undefined,
    };
    const result = await apiFetch(request, "/api/admin/vouchers", {
      method: "POST", body: JSON.stringify(payload),
    });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return redirect("/vouchers");
  }

  if (intent === "deactivate") {
    const id = formData.get("id") as string;
    const result = await apiFetch(request, `/api/admin/vouchers/${id}`, { method: "DELETE" });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return redirect("/vouchers");
  }

  return json({ error: "Intent tidak dikenal" }, { status: 400 });
}

export default function VouchersPage() {
  const { vouchers } = useLoaderData<typeof loader>();
  const actionData    = useActionData<typeof action>();
  const nav           = useNavigation();
  const isSubmitting  = nav.state === "submitting";

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Manajemen Voucher</h1>

      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="font-semibold text-gray-700 mb-4">Buat Voucher</h2>
        <Form method="post" className="grid grid-cols-3 gap-4">
          <input type="hidden" name="intent" value="create" />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Kode</label>
            <input name="code" required placeholder="HEMAT10" className="w-full border rounded-lg px-3 py-2 text-sm uppercase" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tipe</label>
            <select name="type" className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="percentage">Persentase (%)</option>
              <option value="fixed">Nominal Tetap (Rp)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nilai</label>
            <input name="value" type="number" min={1} required className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Min. Belanja (Rp)</label>
            <input name="minPurchase" type="number" min={0} defaultValue={0} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Maks. Diskon (Rp, opsional)</label>
            <input name="maxDiscount" type="number" min={1} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Batas Pemakaian (opsional)</label>
            <input name="usageLimit" type="number" min={1} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>

          {Boolean(actionData?.error) && (
            <p className="col-span-3 text-red-500 text-sm">{formatApiError(actionData?.error)}</p>
          )}

          <div className="col-span-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {isSubmitting ? "Menyimpan..." : "Buat Voucher"}
            </button>
          </div>
        </Form>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Kode</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Diskon</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Pemakaian</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {vouchers.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">Belum ada voucher</td></tr>
            ) : (
              vouchers.map((v: any) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-800">{v.code}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {v.type === "percentage" ? `${v.value}%` : `Rp ${v.value.toLocaleString("id-ID")}`}
                    {v.maxDiscount ? <span className="text-xs text-gray-400"> (maks Rp {v.maxDiscount.toLocaleString("id-ID")})</span> : null}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{v.usageCount}{v.usageLimit ? ` / ${v.usageLimit}` : ""}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${v.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {v.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {v.isActive && (
                      <Form method="post" className="inline">
                        <input type="hidden" name="intent" value="deactivate" />
                        <input type="hidden" name="id" value={v.id} />
                        <button type="submit" className="text-red-500 hover:underline text-xs">Nonaktifkan</button>
                      </Form>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
