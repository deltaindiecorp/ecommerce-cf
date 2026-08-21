import { Hono } from "hono";
import type { Env } from "../types/env";
import { createD1Client, createId } from "@repo/db";
import { users } from "@repo/db/schema";
import { eq, and, like, desc, count, or } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";
import { adminUserCreateSchema, adminUserUpdateSchema, paginationSchema } from "@repo/shared";
import { hashPassword } from "../services/password";
import { logAdminAction } from "../services/audit";

export const adminUsersRouter = new Hono<{ Bindings: Env }>();

// Khusus admin, bukan staff: membuat akun berarti bisa membuat admin baru,
// jadi ini jalur peningkatan wewenang.
adminUsersRouter.use("*", requireAdmin);

// Kolom yang boleh keluar. Hash password TIDAK pernah ikut — panel tidak
// pernah menampilkannya, jadi kebocorannya tidak akan terlihat dari UI.
const PUBLIC_COLUMNS = {
  id: users.id, name: users.name, email: users.email, phone: users.phone,
  role: users.role, isGuest: users.isGuest, isVerified: users.isVerified,
  createdAt: users.createdAt,
};

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
adminUsersRouter.get("/", async (c) => {
  const { page, limit } = paginationSchema.parse(c.req.query());
  const { search, role } = c.req.query();

  const db    = createD1Client(c.env.DB);
  const conds = [eq(users.isGuest, false)];
  if (role)   conds.push(eq(users.role, role as any));
  if (search) conds.push(or(like(users.name, `%${search}%`), like(users.email, `%${search}%`))!);
  const where = and(...conds);

  const [rows, countRows] = await Promise.all([
    db.select(PUBLIC_COLUMNS).from(users).where(where)
      .orderBy(desc(users.createdAt)).limit(limit).offset((page - 1) * limit),
    db.select({ total: count() }).from(users).where(where),
  ]);

  return c.json({ success: true, data: rows, meta: { page, limit, total: countRows[0]?.total ?? 0 } });
});

// ─── POST /api/admin/users ────────────────────────────────────────────────────
// Sebelumnya tidak ada cara membuat akun staff sama sekali. Peran staff sudah
// dipisahkan wewenangnya, tapi satu-satunya jalur pembuatan akun adalah
// bootstrap-admin (sekali pakai) dan registrasi publik (selalu customer) —
// jadi fitur pemisahan peran itu praktis tidak bisa dipakai tanpa SQL manual.
adminUsersRouter.post("/", async (c) => {
  const parsed = adminUserCreateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const { name, email, phone, password, role } = parsed.data;
  const db = createD1Client(c.env.DB);

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return c.json({ success: false, error: "Email sudah terdaftar" }, 409);

  const id = createId();
  await db.insert(users).values({
    id, email, name, phone,
    password:   await hashPassword(password),
    role,
    isGuest:    false,
    // Dibuat admin, jadi identitasnya sudah dianggap terverifikasi — tidak ada
    // alur OTP yang perlu dilalui.
    isVerified: true,
  });

  await logAdminAction(db, {
    actorId: c.get("userId" as any), action: "user.created",
    targetType: "user", targetId: id, metadata: { email, role },
  });

  return c.json({ success: true, data: { id } }, 201);
});

// ─── PATCH /api/admin/users/:id ───────────────────────────────────────────────
adminUsersRouter.patch("/:id", async (c) => {
  const parsed = adminUserUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ success: false, error: parsed.error.flatten() }, 400);

  const db      = createD1Client(c.env.DB);
  const id      = c.req.param("id");
  const actorId = c.get("userId" as any) as string | undefined;

  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) return c.json({ success: false, error: "User tidak ditemukan" }, 404);

  // Mengubah peran diri sendiri adalah cara termudah terkunci dari panel: satu
  // klik salah dan tidak ada jalan kembali tanpa akses SQL.
  //
  // Larangan ini SEKALIGUS menjamin selalu ada admin tersisa, jadi tidak perlu
  // pemeriksaan "admin terakhir" terpisah: penelepon wajib admin (requireAdmin)
  // dan tidak boleh menyasar dirinya sendiri, sehingga setelah penurunan apa pun
  // penelepon itu masih admin. Versi pertama kode ini punya pemeriksaan
  // tersebut, dan pengujian menunjukkan cabangnya tidak pernah bisa dieksekusi.
  if (parsed.data.role && parsed.data.role !== target.role && id === actorId) {
    return c.json({ success: false, error: "Tidak bisa mengubah peran akun sendiri" }, 409);
  }

  await db.update(users).set({ ...parsed.data, updatedAt: new Date() }).where(eq(users.id, id));

  await logAdminAction(db, {
    actorId, action: "user.updated",
    targetType: "user", targetId: id,
    metadata: {
      email: target.email,
      ...(parsed.data.role && parsed.data.role !== target.role
        ? { roleFrom: target.role, roleTo: parsed.data.role }
        : {}),
      changed: Object.keys(parsed.data),
    },
  });

  return c.json({ success: true });
});
