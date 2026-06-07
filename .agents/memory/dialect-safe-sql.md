---
name: Dialect-safe SQL for the Postgres+SQLite dual driver
description: When lib/db can run on either Postgres or SQLite, raw sql`` and PG-only operators silently break the SQLite path.
---

The exported `db` in `lib/db/src/index.ts` is cast to `NodePgDatabase` even when the
runtime driver is `better-sqlite3` (selected by `DB_DRIVER=sqlite`). That cast keeps
the rest of the app type-checking against one type, but it **hides any Postgres-only
SQL from the compiler** — those calls only fail at runtime under SQLite.

**Why:** ScreenCrew ships two modes from one codebase — Postgres (Replit/cloud) and
SQLite (self-host). A query that works on Replit can crash a self-hosted server.

**How to apply:** any time you write `sql\`...\`` or use a drizzle operator that maps
to PG-specific SQL, confirm it also runs on SQLite. Known landmines already fixed:
- `ilike(...)` → SQLite has no `ILIKE`. Use `sql\`lower(${col}) LIKE ${pattern} ESCAPE '\\'\`` (lowercase both sides for case-insensitive match).
- `GREATEST(a, b)` → PG-only. SQLite uses scalar `MAX(a, b)`. Branch on the exported
  `IS_SQLITE` flag (`import { IS_SQLITE } from "@workspace/db"`).
- Body parsers: the raw direct-upload route (`PUT /api/storage/uploads/local/:id`)
  must bypass `express.json()`/`urlencoded()`, or a JSON-typed upload gets drained
  before the stream handler runs.

When auditing, grep for `sql\`` and for operators like `ilike`, `array`, `GREATEST`,
`LEAST`, `NOW()`, `gen_random_uuid`, JSON operators (`->`, `->>`), and `RETURNING`
quirks. Verify each against SQLite before considering a feature done.
