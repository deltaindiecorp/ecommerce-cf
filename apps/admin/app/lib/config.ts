// Satu titik config per-client — cukup ganti nilainya di .env saat deploy ke klien baru
export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

// Alamat storefront. Panel memakainya untuk menautkan ke alur reset password,
// yang halamannya memang tinggal di storefront: tautan dari email juga menunjuk
// ke sana, jadi satu alur untuk semua peran alih-alih dua halaman kembar.
export const STORE_URL = import.meta.env.VITE_STORE_URL ?? "http://localhost:3000";
