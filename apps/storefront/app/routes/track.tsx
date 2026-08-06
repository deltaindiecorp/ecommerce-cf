import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { useLoaderData, useSearchParams, Form } from "@remix-run/react";
import { json } from "@remix-run/cloudflare";
import type { ApiResponse } from "@repo/shared";

import { API_BASE } from "~/lib/config";

export async function loader({ request }: LoaderFunctionArgs) {
  const url      = new URL(request.url);
  const orderId  = url.searchParams.get("orderId");
  const resiNo   = url.searchParams.get("resi");

  if (!orderId && !resiNo) return json({ tracking: null, resi: null });

  const [trackingRes, resiRes] = await Promise.allSettled([
    orderId ? fetch(`${API_BASE}/api/shipping/order/${orderId}/track`) : Promise.resolve(null),
    resiNo  ? fetch(`${API_BASE}/api/shipping/resi/${resiNo}`) : Promise.resolve(null),
  ]);

  const tracking = trackingRes.status === "fulfilled" && trackingRes.value
    ? (await trackingRes.value.json() as ApiResponse<any>) : null;
  const resi = resiRes.status === "fulfilled" && resiRes.value
    ? (await resiRes.value.json() as ApiResponse<any>) : null;

  return json({ tracking, resi });
}

export default function TrackPage() {
  const { tracking, resi } = useLoaderData<typeof loader>();

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Cek Resi / Tracking Order</h1>

      {/* Search Form */}
      <Form method="get" className="flex gap-2 mb-8">
        <input
          name="orderId"
          placeholder="Nomor order (INV/2025/...)"
          className="flex-1 border rounded px-3 py-2"
        />
        <span className="self-center text-gray-400">atau</span>
        <input
          name="resi"
          placeholder="Nomor resi"
          className="flex-1 border rounded px-3 py-2"
        />
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">Cek</button>
      </Form>

      {/* Order Tracking Result */}
      {tracking?.success && (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="font-semibold">{tracking.data.courier?.toUpperCase()}</span>
            <span className="text-sm text-gray-500">{tracking.data.trackingNo}</span>
            <span className="ml-auto px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
              {tracking.data.status}
            </span>
          </div>

          {/* Timeline */}
          {tracking.data.tracking?.history?.length > 0 && (
            <div className="relative pl-6 border-l-2 border-blue-200 space-y-4">
              {tracking.data.tracking.history.map((h: any, i: number) => (
                <div key={i} className="relative">
                  <div className="absolute -left-[25px] w-4 h-4 rounded-full bg-blue-500 border-2 border-white" />
                  <p className="text-sm font-medium">{h.description}</p>
                  <p className="text-xs text-gray-400">{h.date}{h.location ? ` · ${h.location}` : ""}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Resi Result */}
      {resi?.success && !tracking?.success && (
        <div className="space-y-3">
          <p className="font-semibold">Kurir: {resi.data.courier?.toUpperCase()} · {resi.data.status}</p>
          <div className="relative pl-6 border-l-2 border-green-200 space-y-4">
            {resi.data.history?.map((h: any, i: number) => (
              <div key={i} className="relative">
                <div className="absolute -left-[25px] w-4 h-4 rounded-full bg-green-500 border-2 border-white" />
                <p className="text-sm font-medium">{h.description}</p>
                <p className="text-xs text-gray-400">{h.date}{h.location ? ` · ${h.location}` : ""}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {(tracking && !tracking.success) || (resi && !resi.success) ? (
        <p className="text-gray-500 text-center mt-8">Data tidak ditemukan.</p>
      ) : null}
    </div>
  );
}
