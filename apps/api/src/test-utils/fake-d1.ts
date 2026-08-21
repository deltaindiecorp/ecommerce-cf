// D1 tiruan yang merekam setiap SQL yang benar-benar dieksekusi handler.
//
// Dipakai untuk membuktikan query yang jalan tidak menyentuh kolom sensitif —
// pemeriksaan terhadap konstanta proyeksi saja tidak cukup, karena seseorang
// bisa mengembalikan query ke `select()` polos tanpa menyentuh konstantanya.
//
// Hanya diimpor oleh berkas test, jadi tidak pernah ikut ke bundle Worker.

export type RecordedQuery = { sql: string; params: unknown[]; method: string };

export type FakeD1 = {
  env:      Record<string, unknown>;
  executed: RecordedQuery[];
  /** Semua SQL yang dieksekusi, digabung — enak untuk assertion "tidak memuat X". */
  allSql:   () => string;
};

export function makeRecordingD1(
  extraEnv: Record<string, unknown> = {},
  rowsFor: (sql: string, method: string) => unknown[] = () => [],
): FakeD1 {
  const executed: RecordedQuery[] = [];

  const makeStmt = (sql: string, params: unknown[] = []) => {
    const stmt: Record<string, unknown> = {
      bind: (...args: unknown[]) => makeStmt(sql, args),
      all:   async () => {
        executed.push({ sql, params, method: "all" });
        return { results: rowsFor(sql, "all"), success: true, meta: {} };
      },
      run:   async () => {
        executed.push({ sql, params, method: "run" });
        return { results: [], success: true, meta: {} };
      },
      raw:   async () => {
        executed.push({ sql, params, method: "raw" });
        return rowsFor(sql, "raw");
      },
      first: async () => {
        executed.push({ sql, params, method: "first" });
        return rowsFor(sql, "first")[0] ?? null;
      },
    };
    return stmt;
  };

  const env = {
    DB: {
      prepare: (sql: string) => makeStmt(sql),
      batch:   async (stmts: unknown[]) =>
        stmts.map(() => ({ results: [], success: true, meta: {} })),
    },
    CACHE_KV: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    },
    // Dibaca middleware auth untuk cek daftar cabut token. `get` selalu null =
    // tidak ada token yang dicabut, yang benar untuk sebagian besar test.
    SESSION_KV: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    },
    ...extraEnv,
  };

  return {
    env,
    executed,
    allSql: () => executed.map(e => e.sql).join("\n"),
  };
}
