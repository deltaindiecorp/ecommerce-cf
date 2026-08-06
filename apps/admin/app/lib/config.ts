// Satu titik config per-client — cukup ganti VITE_API_BASE di .env saat deploy ke klien baru
export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
