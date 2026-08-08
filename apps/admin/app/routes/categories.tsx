import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";

import { apiFetch, apiPublic, formatApiError } from "~/lib/api";

export async function loader({ request }: LoaderFunctionArgs) {
  void request;
  const body = await apiPublic<any[]>("/api/catalog/categories");
  return json({ categories: body.data ?? [] });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent   = formData.get("intent") as string;

  if (intent === "create") {
    const payload = {
      name: formData.get("name"),
      slug: formData.get("slug"),
      sortOrder: Number(formData.get("sortOrder") || 0),
    };
    const result = await apiFetch(request, "/api/catalog/categories", {
      method: "POST", body: JSON.stringify(payload),
    });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return redirect("/categories");
  }

  if (intent === "deactivate") {
    const id = formData.get("id") as string;
    const result = await apiFetch(request, `/api/catalog/categories/${id}`, { method: "DELETE" });
    if (!result.success) return json({ error: result.error }, { status: 400 });
    return redirect("/categories");
  }

  return json({ error: "Intent tidak dikenal" }, { status: 400 });
}

export default function CategoriesPage() {
  const { categories } = useLoaderData<typeof loader>();
  const actionData      = useActionData<typeof action>();
  const nav             = useNavigation();
  const isSubmitting    = nav.state === "submitting";

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Manajemen Kategori</h1>

      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="font-semibold text-gray-700 mb-4">Tambah Kategori</h2>
        <Form method="post" className="grid grid-cols-3 gap-4 items-end">
          <input type="hidden" name="intent" value="create" />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nama</label>
            <input name="name" required className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Slug</label>
            <input name="slug" required placeholder="pakaian-pria" className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Urutan</label>
            <input name="sortOrder" type="number" defaultValue={0} className="w-full border rounded-lg px-3 py-2 text-sm" />
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
              {isSubmitting ? "Menyimpan..." : "Simpan Kategori"}
            </button>
          </div>
        </Form>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Nama</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Slug</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Urutan</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {categories.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-10 text-gray-400">Belum ada kategori aktif</td></tr>
            ) : (
              categories.map((cat: any) => (
                <tr key={cat.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{cat.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{cat.slug}</td>
                  <td className="px-4 py-3 text-gray-600">{cat.sortOrder}</td>
                  <td className="px-4 py-3 text-right">
                    <Form method="post" className="inline">
                      <input type="hidden" name="intent" value="deactivate" />
                      <input type="hidden" name="id" value={cat.id} />
                      <button type="submit" className="text-red-500 hover:underline text-xs">Nonaktifkan</button>
                    </Form>
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
