import * as pg from "drizzle-orm/pg-core";
import * as sqlite from "drizzle-orm/sqlite-core";

/**
 * Dialect-agnostic column/table helpers so a single schema definition can target
 * either Postgres (Quick Session / Replit, the default) or SQLite (self-hosted).
 *
 * The selected dialect is decided once at import time by `DB_DRIVER`. At runtime
 * the helpers return the matching dialect's builders; at compile time we expose
 * the Postgres builder types (via `pick`) because the inferred row/insert types
 * are identical for the column set this app uses (text, int, boolean, timestamp,
 * auto-increment id). This keeps every consumer typed against one stable shape.
 */
export const IS_SQLITE = process.env.DB_DRIVER === "sqlite";

/** Return the sqlite value at runtime when in SQLite mode, but keep the Postgres type. */
function pick<P, S>(pgVal: P, _sqliteVal: S): P {
  return (IS_SQLITE ? (_sqliteVal as unknown as P) : pgVal);
}

export const dbTable = (IS_SQLITE ? sqlite.sqliteTable : pg.pgTable) as typeof pg.pgTable;
export const dbUnique = (IS_SQLITE ? sqlite.unique : pg.unique) as typeof pg.unique;

/** Auto-incrementing integer primary key. */
export const idCol = () =>
  pick(
    pg.serial("id").primaryKey(),
    sqlite.integer("id").primaryKey({ autoIncrement: true }),
  );

export const txt = (name: string) => pick(pg.text(name), sqlite.text(name));

export const int = (name: string) => pick(pg.integer(name), sqlite.integer(name));

export const bool = (name: string) =>
  pick(pg.boolean(name), sqlite.integer(name, { mode: "boolean" }));

/** Nullable timestamp column. */
export const ts = (name: string) =>
  pick(pg.timestamp(name), sqlite.integer(name, { mode: "timestamp" }));

/** Not-null timestamp defaulting to "now" at insert time. */
export const tsCreated = (name: string) =>
  pick(
    pg.timestamp(name).notNull().defaultNow(),
    sqlite
      .integer(name, { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  );
