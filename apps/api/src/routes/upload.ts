import { Hono } from "hono";
import type { Env } from "../types/env";
import { requireAdmin, requireStaff } from "../middleware/auth";
import { createId } from "@repo/db";
import { detectImageType, IMAGE_EXTENSION } from "../lib/image-type";

export const uploadRouter = new Hono<{ Bindings: Env }>();

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// ─── POST /api/upload/product-image ───────────────────────────────────────────
uploadRouter.post("/product-image", requireStaff, async (c) => {
  const formData = await c.req.formData();
  // @cloudflare/workers-types mengetik FormData.get() sebagai `string | null` saja,
  // padahal runtime-nya bisa mengembalikan File untuk multipart file field.
  const file = formData.get("file") as unknown;

  if (!(file instanceof File)) {
    return c.json({ success: false, error: "File tidak ditemukan (field 'file')" }, 400);
  }
  if (file.size > MAX_SIZE_BYTES) {
    return c.json({ success: false, error: "Ukuran file maksimal 5MB" }, 400);
  }

  const buffer = await file.arrayBuffer();
  // Deteksi tipe dari isi file (magic bytes), bukan dari file.type yang
  // diklaim client di header multipart — itu gampang dipalsukan.
  const detectedType = detectImageType(new Uint8Array(buffer));
  if (!detectedType) {
    return c.json({ success: false, error: "File bukan gambar JPEG/PNG/WebP yang valid" }, 400);
  }

  const filename = `${createId()}.${IMAGE_EXTENSION[detectedType]}`;
  await c.env.STORAGE.put(`products/${filename}`, buffer, {
    httpMetadata: { contentType: detectedType },
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
