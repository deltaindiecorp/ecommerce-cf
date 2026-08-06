import { fileURLToPath } from "node:url";
import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: { port: 3001, strictPort: true },
  // Entry server default Remix Cloudflare pakai `renderToReadableStream` dari
  // react-dom/server — export itu cuma ada di build "worker" (react-dom/server.browser.js),
  // bukan di build Node default. Tanpa ini, dev server error saat SSR.
  ssr: {
    resolve: {
      conditions: ["workerd", "worker"],
      externalConditions: ["workerd", "worker"],
    },
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  plugins: [
    tailwindcss(),
    remix({
      future: {
        v3_fetcherPersist:     true,
        v3_relativeSplatPath:  true,
        v3_throwAbortReason:   true,
      },
    }),
  ],
});
