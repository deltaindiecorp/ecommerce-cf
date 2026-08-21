import { Hono } from "hono";
import type { Env } from "../types/env";
import { createD1Client } from "@repo/db";
import { storeSettings, STORE_SETTINGS_ID } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";
import { storeSettingsUpdateSchema } from "@repo/shared";
import { logAdminAction } from "../services/audit";

export const settingsRouter = new Hono<{ Bindings: Env }>();

const CACHE_KEY = "store:settings";
const CACHE_TTL = 300; // 5 menit — perubahan identitas toko jarang dan tidak mendesak

// Nilai bawaan dipakai saat barisnya belum pernah dibuat, supaya storefront
// tetap punya identitas yang bisa dirender pada deployment yang baru dibuat.
const DEFAULTS = {
  id:           STORE_SETTINGS_ID,
  storeName:    "Deltacommerce",
  tagline:      null,
  supportEmail: null,
  supportPhone: null,
  address:      null,
};

// ─── GET /api/settings ────────────────────────────────────────────────────────
// Publik: storefront memanggilnya di root loader setiap halaman, jadi di-cache
// di KV supaya tidak menambah satu query D1 per kunjungan.
settingsRouter.get("/", async (c) => {
  const cached = await c.env.CACHE_KV.get(CACHE_KEY);
  if (cached) return c.json({ success: true, data: JSON.parse(cached), cached: true });

  const db  = createD1Client(c.env.DB);
  const row = await db.query.storeSettings.findFirst({
    where: eq(storeSettings.id, STORE_SETTINGS_ID),
  });

  const data = row ?? DEFAULTS;
  await c.env.CACHE_KV.put(CACHE_KEY, JSON.stringify(data), { expirationTtl: CACHE_TTL });

  return c.json({ success: true, data });
});

// ─── PATCH /api/admin/settings ────────────────────────────────────────────────
settingsRouter.patch("/", requireAdmin, async (c) => {
  const parsed = storeSettingsUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const db      = createD1Client(c.env.DB);
  const current = await db.query.storeSettings.findFirst({
    where: eq(storeSettings.id, STORE_SETTINGS_ID),
  });

  if (current) {
    await db.update(storeSettings)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(storeSettings.id, STORE_SETTINGS_ID));
  } else {
    await db.insert(storeSettings).values({ ...DEFAULTS, ...parsed.data, id: STORE_SETTINGS_ID });
  }

  // Cache dibuang agar perubahan langsung terlihat; tanpa ini admin mengira
  // simpanannya gagal karena storefront masih menampilkan nama lama.
  await c.env.CACHE_KV.delete(CACHE_KEY);

  await logAdminAction(db, {
    actorId:    c.get("userId" as any),
    action:     "settings.updated",
    targetType: "settings",
    targetId:   STORE_SETTINGS_ID,
    metadata:   { changed: Object.keys(parsed.data) },
  });

  return c.json({ success: true });
});
