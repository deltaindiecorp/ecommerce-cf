// Entry point Cloudflare Pages Functions.
//
// Tanpa file ini, `wrangler pages deploy` hanya menerbitkan aset statis dan
// SELURUH loader/action Remix tidak pernah jalan — halaman admin akan kosong di
// produksi meski mulus di `remix vite:dev`, karena dev server menjalankan SSR
// sendiri. Nama `[[path]]` menangkap semua rute agar Remix yang mengaturnya.
import { createPagesFunctionHandler } from "@remix-run/cloudflare-pages";

// Dihasilkan oleh `remix vite:build`; belum ada sebelum build pertama, dan
// memang tidak ikut dilacak git. Skrip `deploy` bergantung pada `build` lewat
// turbo.json sehingga urutannya terjamin.
// @ts-expect-error - modul build dibuat saat build, bukan di source tree
import * as build from "../build/server";

export const onRequest = createPagesFunctionHandler({ build });
