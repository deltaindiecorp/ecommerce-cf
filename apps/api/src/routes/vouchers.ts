import { Hono } from "hono";
import type { Env } from "../types/env";
import { requireAdmin } from "../middleware/auth";
import { createD1Client, createId } from "@repo/db";
import { vouchers } from "@repo/db/schema";
import { eq, desc, count } from "drizzle-orm";
import { voucherInputSchema, voucherUpdateSchema, paginationSchema } from "@repo/shared";

export const voucherAdminRouter = new Hono<{ Bindings: Env }>();

voucherAdminRouter.use("*", requireAdmin);

// ─── GET /api/admin/vouchers ───────────────────────────────────────────────────
voucherAdminRouter.get("/", async (c) => {
  const { page, limit } = paginationSchema.parse(c.req.query());
  const db = createD1Client(c.env.DB);

  // `meta` sebelumnya tidak dikirim sama sekali, padahal endpointnya sudah
  // memotong hasil per halaman — panel tidak punya cara tahu masih ada berapa,
  // jadi penavigasinya mustahil ditampilkan.
  const [rows, countRows] = await Promise.all([
    db.select().from(vouchers)
      .orderBy(desc(vouchers.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(vouchers),
  ]);

  return c.json({
    success: true,
    data:    rows,
    meta:    { page, limit, total: countRows[0]?.total ?? 0 },
  });
});

// ─── POST /api/admin/vouchers ──────────────────────────────────────────────────
voucherAdminRouter.post("/", async (c) => {
  const parsed = voucherInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const db   = createD1Client(c.env.DB);
  const code = parsed.data.code.toUpperCase();

  const existing = await db.query.vouchers.findFirst({ where: eq(vouchers.code, code) });
  if (existing) return c.json({ success: false, error: "Kode voucher sudah dipakai" }, 409);

  const id = createId();
  await db.insert(vouchers).values({
    id,
    ...parsed.data,
    code,
    startsAt:  parsed.data.startsAt  ? new Date(parsed.data.startsAt)  : null,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  });

  return c.json({ success: true, data: { id, code } }, 201);
});

// ─── PATCH /api/admin/vouchers/:id ────────────────────────────────────────────
voucherAdminRouter.patch("/:id", async (c) => {
  const parsed = voucherUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const db = createD1Client(c.env.DB);
  const id = c.req.param("id");
  const current = await db.query.vouchers.findFirst({ where: eq(vouchers.id, id) });
  if (!current) return c.json({ success: false, error: "Voucher tidak ditemukan" }, 404);

  const { startsAt, expiresAt, code, ...rest } = parsed.data;
  await db.update(vouchers).set({
    ...rest,
    ...(code       ? { code: code.toUpperCase() } : {}),
    ...(startsAt   !== undefined ? { startsAt:  startsAt  ? new Date(startsAt)  : null } : {}),
    ...(expiresAt  !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
  }).where(eq(vouchers.id, id));

  return c.json({ success: true });
});

// ─── DELETE /api/admin/vouchers/:id ───────────────────────────────────────────
// Nonaktifkan, bukan hapus baris (menjaga histori usageCount / referensi order)
voucherAdminRouter.delete("/:id", async (c) => {
  const db = createD1Client(c.env.DB);
  const id = c.req.param("id");
  const current = await db.query.vouchers.findFirst({ where: eq(vouchers.id, id) });
  if (!current) return c.json({ success: false, error: "Voucher tidak ditemukan" }, 404);

  await db.update(vouchers).set({ isActive: false }).where(eq(vouchers.id, id));
  return c.json({ success: true });
});
