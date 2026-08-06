import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import * as schema from "./schema";

// ─── D1 Client (current) ────────────────────────────────────────────────────
export function createD1Client(d1: D1Database) {
  return drizzleD1(d1, { schema });
}

export type DbClient = ReturnType<typeof createD1Client>;

// ─── Migration Path: Neon (uncomment when ready) ────────────────────────────
// import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
// import { neon } from "@neondatabase/serverless";
//
// export function createNeonClient(connectionString: string) {
//   const sql = neon(connectionString);
//   return drizzleNeon(sql, { schema });
// }
//
// Steps to migrate:
// 1. pnpm add @neondatabase/serverless drizzle-orm
// 2. Add NEON_DATABASE_URL to wrangler.toml [vars]
// 3. Add Hyperdrive binding in wrangler.toml
// 4. Replace createD1Client with createNeonClient in all workers
// 5. Run: pnpm db:generate && pnpm db:migrate

export * from "./schema";
