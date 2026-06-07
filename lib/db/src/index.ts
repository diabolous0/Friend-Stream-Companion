import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

/**
 * Driver selection (set by the api-server config layer via env):
 * - default / "postgres": Quick Session & Replit — node-postgres, unchanged.
 * - "sqlite": self-hosted single-file mode — better-sqlite3, loaded lazily so the
 *   native module is never required (or even resolved) in Postgres mode.
 *
 * `db` is always typed as the Postgres database. The column set this app uses
 * infers identical row/insert types across both dialects, so consumers stay
 * typed against one stable shape regardless of the active driver.
 */
type DB = NodePgDatabase<typeof schema>;

let dbInstance: DB;
let poolInstance: pg.Pool | undefined;

if (process.env.DB_DRIVER === "sqlite") {
  const sqlitePath = process.env.SQLITE_PATH || "./data/screencrew.db";
  if (sqlitePath !== ":memory:") {
    mkdirSync(dirname(sqlitePath), { recursive: true });
  }
  // Lazy, runtime-only require so esbuild never bundles the sqlite driver and the
  // native better-sqlite3 binary is only loaded when self-hosting on SQLite.
  const requireRuntime = createRequire(import.meta.url);
  const Database = requireRuntime("better-sqlite3");
  const { drizzle: drizzleSqlite } = requireRuntime("drizzle-orm/better-sqlite3");
  const sqliteDb = new Database(sqlitePath);
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.pragma("foreign_keys = ON");
  dbInstance = drizzleSqlite(sqliteDb, { schema }) as unknown as DB;
} else {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  poolInstance = new Pool({ connectionString: process.env.DATABASE_URL });
  dbInstance = drizzlePg(poolInstance, { schema });
}

export const db = dbInstance;
export const pool = poolInstance;

export * from "./schema";
export { IS_SQLITE } from "./schema/_dialect";
