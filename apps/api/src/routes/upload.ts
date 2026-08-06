import { Hono } from "hono";
import type { Env } from "../types/env";
import { requireAdmin } from "../middleware/auth";
import { createId } from "@repo/db";

export const uploadRouter = new Hono<{ Bindings: Env }>();

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
};
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// ─── POST /api/upload/product-image ───────────────────────────────────────────
uploadRouter.post("/product-image", requireAdmin, async (c) => {
  const formData = await c.req.formData();
  // @cloudflare/workers-types mengetik FormData.get() sebagai `string | null` saja,
  // padahal runtime-nya bisa mengembalikan File untuk multipart file field.
  const file = formData.get("file") as unknown;

  if (!(file instanceof File)) {
    return c.json({ success: false, error: "File tidak ditemukan (field 'file')" }, 400);
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return c.json({ success: false, error: "Tipe file tidak didukung. Gunakan JPEG, PNG, atau WebP." }, 400);
  }
  if (file.size > MAX_SIZE_BYTES) {
    return c.json({ success: false, error: "Ukuran file maksimal 5MB" }, 400);
  }

  const filename = `${createId()}.${ext}`;
  await c.env.STORAGE.put(`products/${filename}`, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  const url = `${new URL(c.req.url).origin}/api/upload/product-image/${filename}`;
  return c.json({ success: true, data: { filename, url } }, 201);
});

// ─── GET /api/upload/product-image/:filename ──────────────────────────────────
// Serve gambar dari R2 — publik, dipakai sebagai imageUrl produk/varian.
uploadRouter.get("/product-image/:filename", async (c) => {
  const { filename } = c.req.param();
  const object = await c.env.STORAGE.get(`products/${filename}`);
  if (!object) return c.json({ success: false, error: "Gambar tidak ditemukan" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type":  object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "ETag":          object.httpEtag,
    },
  });
});

// ─── DELETE /api/upload/product-image/:filename ───────────────────────────────
uploadRouter.delete("/product-image/:filename", requireAdmin, async (c) => {
  const { filename } = c.req.param();
  await c.env.STORAGE.delete(`products/${filename}`);
  return c.json({ success: true });
});
