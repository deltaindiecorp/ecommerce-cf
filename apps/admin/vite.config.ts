import { fileURLToPath } from "node:url";
import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
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
