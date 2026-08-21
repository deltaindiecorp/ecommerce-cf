import { useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";

import { formatApiError } from "~/lib/api";

// ─── Pengelola gambar produk ──────────────────────────────────────────────────
// Sebelumnya field gambar hanya textarea berisi URL, dan endpoint unggahnya
// (POST /api/upload/product-image) menganggur — admin harus mengunggah sendiri
// lewat curl lalu menempelkan URL-nya.
//
// Daftar URL tetap dikirim lewat satu input tersembunyi berisi baris-baris URL,
// jadi action produk tidak perlu berubah bentuk sama sekali.
export function ImageManager({ name, initial }: { name: string; initial: string[] }) {
  const [urls, setUrls] = useState<string[]>(initial);
  const fetcher   = useFetcher<{ success: boolean; url?: string; error?: unknown }>();
  const fileInput = useRef<HTMLInputElement>(null);

  const uploading = fetcher.state !== "idle";

  // Hasil unggah datang lewat fetcher; tambahkan begitu URL-nya tiba.
  useEffect(() => {
    const url = fetcher.data?.success ? fetcher.data.url : undefined;
    if (!url) return;
    setUrls(prev => (prev.includes(url) ? prev : [...prev, url]));
    if (fileInput.current) fileInput.current.value = "";
  }, [fetcher.data]);

  function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fetcher.submit(fd, {
      method:  "POST",
      action:  "/api/upload-image",
      encType: "multipart/form-data",
    });
  }

  return (
    <div>
      {/* Satu-satunya nilai yang benar-benar ikut ter-submit bersama form produk */}
      <input type="hidden" name={name} value={urls.join("\n")} />

      {urls.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-3">
          {urls.map((url, i) => (
            <div key={url} className="relative group">
              <img
                src={url}
                alt={`Gambar ${i + 1}`}
                className="w-20 h-20 object-cover rounded-lg border border-gray-200 bg-gray-50"
              />
              {i === 0 && (
                <span className="absolute bottom-0 inset-x-0 bg-gray-900/70 text-white text-[10px] text-center rounded-b-lg py-0.5">
                  Utama
                </span>
              )}
              <button
                type="button"
                onClick={() => setUrls(prev => prev.filter(u => u !== url))}
                aria-label={`Hapus gambar ${i + 1}`}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-xs leading-none opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={uploading}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
          className="text-xs text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0
                     file:bg-gray-100 file:text-gray-700 file:text-xs file:font-medium hover:file:bg-gray-200
                     disabled:opacity-50"
        />
        {uploading && <span className="text-xs text-gray-400">Mengunggah...</span>}
      </div>

      {fetcher.data && !fetcher.data.success && (
        <p className="text-xs text-red-600 mt-2">{formatApiError(fetcher.data.error)}</p>
      )}

      <p className="text-[11px] text-gray-400 mt-2">
        JPEG, PNG, atau WebP — maksimal 5MB. Gambar pertama dipakai sebagai gambar utama.
      </p>
    </div>
  );
}
