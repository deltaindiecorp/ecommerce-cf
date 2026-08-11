import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/cloudflare";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { json, redirect } from "@remix-run/cloudflare";
import { useState, useEffect } from "react";
import type { ShippingRate, ApiResponse, CityOption } from "@repo/shared";

import { API_BASE } from "~/lib/config";
import { apiFetch, formatApiError } from "~/lib/api";
import { SiteHeader } from "~/components/SiteHeader";
import { SiteFooter } from "~/components/SiteFooter";
import { MobileBottomNav } from "~/components/MobileBottomNav";

export async function loader({ request }: LoaderFunctionArgs) {
  const cartId = new URL(request.url).searchParams.get("cartId") ?? "";
  const { data: cart } = await apiFetch<any>(request, "/api/cart", {
    headers: { "X-Cart-Id": cartId },
  });
  if (!cart || cart.items.length === 0) return redirect("/");

  const totalWeight = cart.items.reduce((s: number, i: any) => s + i.weight * i.qty, 0);
  return json({ cart, cartId, totalWeight });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const cartId   = formData.get("cartId") as string;

  const payload = {
    guestName:  formData.get("guestName"),
    guestEmail: formData.get("guestEmail"),
    guestPhone: formData.get("guestPhone"),
    shippingAddress: {
      name:            formData.get("name"),
      phone:           formData.get("phone"),
      address:         formData.get("address"),
      district:        formData.get("district"),
      city:            formData.get("city"),
      province:        formData.get("province"),
      postalCode:      formData.get("postalCode"),
      rajaongkirCityId:Number(formData.get("rajaongkirCityId")),
    },
    courier:       formData.get("courier"),
    service:       formData.get("service"),
    shippingCost:  Number(formData.get("shippingCost")),
    paymentMethod: formData.get("paymentMethod") ?? "midtrans",
    voucherCode:   formData.get("voucherCode") || undefined,
    note:          formData.get("note"),
  };

  const result = await apiFetch<any>(request, "/api/checkout", {
    method:  "POST",
    headers: { "X-Cart-Id": cartId },
    body:    JSON.stringify(payload),
  });
  if (!result.success) return json({ error: result.error }, { status: 400 });

  // Redirect ke halaman payment
  return redirect(`/payment?orderId=${result.data.orderId}&cartId=${cartId}`);
}

export default function CheckoutPage() {
  const { cart, cartId, totalWeight } = useLoaderData<typeof loader>();
  const actionData       = useActionData<typeof action>();
  const nav              = useNavigation();
  const isSubmitting     = nav.state === "submitting";

  // ─── Pencarian kota (autocomplete RajaOngkir) ───────────────────────────────
  const [citySearch, setCitySearch]     = useState("");
  const [cityOptions, setCityOptions]   = useState<CityOption[]>([]);
  const [cityLoading, setCityLoading]   = useState(false);
  const [selectedCity, setSelectedCity] = useState<CityOption | null>(null);
  const [cityText, setCityText]         = useState("");
  const [provinceText, setProvinceText] = useState("");
  const [postalCodeText, setPostalCodeText] = useState("");

  // Debounce 300ms supaya tidak fetch di setiap ketikan
  useEffect(() => {
    if (selectedCity || citySearch.trim().length < 2) {
      setCityOptions([]);
      return;
    }
    setCityLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res  = await fetch(`${API_BASE}/api/shipping/cities?search=${encodeURIComponent(citySearch)}`);
        const body = await res.json() as ApiResponse<CityOption[]>;
        setCityOptions(body.success ? body.data : []);
      } catch {
        setCityOptions([]);
      } finally {
        setCityLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [citySearch, selectedCity]);

  function selectCity(city: CityOption) {
    setSelectedCity(city);
    setCitySearch(`${city.type} ${city.cityName}`);
    setCityOptions([]);
    setCityText(city.cityName);
    setProvinceText(city.province);
    setPostalCodeText(city.postalCode);
    setDestinationCityId(String(city.cityId));
  }

  // ─── Ongkir dinamis ──────────────────────────────────────────────────────
  const [destinationCityId, setDestinationCityId] = useState("");
  const [rates, setRates]           = useState<ShippingRate[]>([]);
  const [selectedRate, setSelectedRate] = useState<ShippingRate | null>(null);
  const [ongkirLoading, setOngkirLoading] = useState(false);
  const [ongkirError, setOngkirError]     = useState<string | null>(null);

  async function checkOngkir() {
    if (!destinationCityId) {
      setOngkirError("Cari dan pilih kota tujuan dulu");
      return;
    }
    setOngkirLoading(true);
    setOngkirError(null);
    setSelectedRate(null);
    try {
      const originRes  = await fetch(`${API_BASE}/api/shipping/origin`);
      const originBody = await originRes.json() as ApiResponse<{ rajaongkirCityId: number }>;
      if (!originBody.success) throw new Error(originBody.error);

      const params = new URLSearchParams({
        origin:      String(originBody.data.rajaongkirCityId),
        destination: destinationCityId,
        weight:      String(Math.max(totalWeight, 1)),
      });
      const res  = await fetch(`${API_BASE}/api/shipping/ongkir?${params}`);
      const body = await res.json() as ApiResponse<ShippingRate[]>;
      if (!body.success) throw new Error(body.error);

      setRates(body.data);
      if (body.data.length === 0) setOngkirError("Tidak ada layanan kurir untuk tujuan ini");
    } catch (err) {
      setOngkirError(err instanceof Error ? err.message : "Gagal cek ongkir");
    } finally {
      setOngkirLoading(false);
    }
  }

  // ─── Voucher ─────────────────────────────────────────────────────────────
  const [voucherCode, setVoucherCode]       = useState("");
  const [voucherDiscount, setVoucherDiscount] = useState<number | null>(null);
  const [voucherError, setVoucherError]       = useState<string | null>(null);
  const [voucherLoading, setVoucherLoading]   = useState(false);

  async function checkVoucher() {
    if (!voucherCode) return;
    setVoucherLoading(true);
    setVoucherError(null);
    setVoucherDiscount(null);
    try {
      const res  = await fetch(`${API_BASE}/api/checkout/voucher/validate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ code: voucherCode, subtotal: cart.subtotal }),
      });
      const body = await res.json() as ApiResponse<{ discount: number }>;
      if (!body.success) throw new Error(body.error);
      setVoucherDiscount(body.data.discount);
    } catch (err) {
      setVoucherError(err instanceof Error ? err.message : "Voucher tidak valid");
    } finally {
      setVoucherLoading(false);
    }
  }

  const shippingCost = selectedRate?.cost ?? 0;
  const discount      = voucherDiscount ?? 0;
  const total          = cart.subtotal + shippingCost - discount;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-16 md:pb-0">
      <SiteHeader />
      <div className="flex-1 max-w-2xl mx-auto p-6 w-full">
      <h1 className="text-2xl font-bold mb-6">Checkout</h1>

      <Form method="post" className="space-y-6">
        <input type="hidden" name="cartId" value={cartId} />
        <input type="hidden" name="courier" value={selectedRate?.courier ?? ""} />
        <input type="hidden" name="service" value={selectedRate?.service ?? ""} />
        <input type="hidden" name="shippingCost" value={shippingCost} />

        {/* Guest Info */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Informasi Pemesan</h2>
          <div className="grid gap-4">
            <input name="guestName"  placeholder="Nama lengkap" required className="input" />
            <input name="guestEmail" type="email" placeholder="Email" required className="input" />
            <input name="guestPhone" placeholder="No. HP (08xx)" required className="input" />
          </div>
        </section>

        {/* Shipping Address */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Alamat Pengiriman</h2>
          <div className="grid gap-4">
            <input name="name"     placeholder="Nama penerima" required className="input" />
            <input name="phone"    placeholder="No. HP penerima" required className="input" />
            <textarea name="address" placeholder="Alamat lengkap" required className="input" rows={3} />
            <input name="district" placeholder="Kecamatan" required className="input" />

            {/* Autocomplete kota tujuan (RajaOngkir) */}
            <div className="relative">
              <input
                placeholder="Cari kota tujuan... (mis. Bandung)"
                required
                className="input w-full"
                value={citySearch}
                onChange={(e) => { setCitySearch(e.target.value); setSelectedCity(null); }}
              />
              {cityLoading && <p className="text-xs text-gray-400 mt-1">Mencari...</p>}
              {cityOptions.length > 0 && (
                <div className="absolute z-10 bg-white border rounded shadow mt-1 max-h-48 overflow-y-auto w-full">
                  {cityOptions.map((city) => (
                    <button
                      key={city.cityId}
                      type="button"
                      onClick={() => selectCity(city)}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {city.type} {city.cityName}, {city.province}
                    </button>
                  ))}
                </div>
              )}
              {selectedCity && (
                <p className="text-green-600 text-xs mt-1">✓ {selectedCity.type} {selectedCity.cityName} dipilih</p>
              )}
            </div>

            <input
              name="city" placeholder="Kota" required className="input"
              value={cityText} onChange={(e) => setCityText(e.target.value)}
            />
            <input
              name="province" placeholder="Provinsi" required className="input"
              value={provinceText} onChange={(e) => setProvinceText(e.target.value)}
            />
            <input
              name="postalCode" placeholder="Kode pos" required className="input"
              value={postalCodeText} onChange={(e) => setPostalCodeText(e.target.value)}
            />
            <input type="hidden" name="rajaongkirCityId" value={destinationCityId} />
          </div>
        </section>

        {/* Shipping */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Kurir</h2>
          <button
            type="button"
            onClick={checkOngkir}
            disabled={ongkirLoading}
            className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded disabled:opacity-50"
          >
            {ongkirLoading ? "Mengecek..." : "Cek Ongkir"}
          </button>

          {ongkirError && <p className="text-red-500 text-sm mt-2">{ongkirError}</p>}

          {rates.length > 0 && (
            <div className="mt-3 space-y-2">
              {rates.map((r, i) => (
                <label
                  key={`${r.courier}-${r.service}-${i}`}
                  className={`flex items-center justify-between gap-2 p-3 border rounded cursor-pointer ${
                    selectedRate === r ? "border-blue-600 ring-1 ring-blue-600" : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="_rateChoice"
                      checked={selectedRate === r}
                      onChange={() => setSelectedRate(r)}
                    />
                    <span>
                      <span className="font-medium">{r.courierName} — {r.serviceName}</span>
                      <span className="block text-xs text-gray-400">Estimasi {r.etd} hari</span>
                    </span>
                  </span>
                  <span className="font-semibold">Rp {r.cost.toLocaleString("id-ID")}</span>
                </label>
              ))}
            </div>
          )}
        </section>

        {/* Voucher */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Voucher</h2>
          <div className="flex gap-2">
            <input
              name="voucherCode"
              placeholder="Kode voucher (opsional)"
              className="input flex-1"
              value={voucherCode}
              onChange={(e) => { setVoucherCode(e.target.value.toUpperCase()); setVoucherDiscount(null); setVoucherError(null); }}
            />
            <button
              type="button"
              onClick={checkVoucher}
              disabled={voucherLoading || !voucherCode}
              className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded disabled:opacity-50"
            >
              {voucherLoading ? "Mengecek..." : "Cek"}
            </button>
          </div>
          {voucherError && <p className="text-red-500 text-sm mt-2">{voucherError}</p>}
          {voucherDiscount != null && (
            <p className="text-green-600 text-sm mt-2">Diskon Rp {voucherDiscount.toLocaleString("id-ID")} diterapkan</p>
          )}
        </section>

        {/* Payment Method */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Metode Pembayaran</h2>
          <div className="grid grid-cols-3 gap-3">
            {["midtrans", "xendit", "cod"].map(m => (
              <label key={m} className="flex items-center gap-2 p-3 border rounded cursor-pointer">
                <input type="radio" name="paymentMethod" value={m} defaultChecked={m === "midtrans"} />
                <span className="capitalize">{m === "cod" ? "COD" : m}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Note */}
        <textarea name="note" placeholder="Catatan untuk penjual (opsional)" className="input w-full" rows={2} />

        {/* Error */}
        {Boolean(actionData?.error) && (
          <p className="text-red-500 text-sm">{formatApiError(actionData?.error)}</p>
        )}

        {/* Summary */}
        <div className="border rounded p-4 bg-gray-50">
          <div className="flex justify-between mb-2">
            <span>Subtotal ({cart.itemCount} item)</span>
            <span>Rp {cart.subtotal.toLocaleString("id-ID")}</span>
          </div>
          <div className="flex justify-between mb-2">
            <span>Ongkir</span>
            <span>{selectedRate ? `Rp ${shippingCost.toLocaleString("id-ID")}` : "Belum dipilih"}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between mb-2 text-green-600">
              <span>Diskon</span>
              <span>-Rp {discount.toLocaleString("id-ID")}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-lg mt-3 pt-3 border-t">
            <span>Total</span>
            <span>Rp {total.toLocaleString("id-ID")}</span>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !selectedRate}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50"
        >
          {isSubmitting ? "Memproses..." : !selectedRate ? "Pilih kurir dulu" : "Buat Pesanan"}
        </button>
      </Form>
      </div>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
