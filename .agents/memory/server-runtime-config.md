---
name: Runtime-mutable server config
description: How admin-editable server settings override the immutable startup config, and the singleton-row pattern used to persist them.
---

# Runtime-mutable server config

The static config resolver (`api-server/src/lib/config.ts`) is immutable — resolved
once at startup from env → file → defaults. Admin-editable settings (server name,
description, registration mode, max users) live in a separate DB overrides layer
that is merged over the static config (`override ?? config default`).

**Rule:** any read path that enforces or displays a configurable value must consult
the *merged* settings helper, not `config.*` directly. Missing one (e.g. the
register route's registration/maxUsers checks) means the admin's change silently
doesn't take effect there.

**Why:** the feature's whole point is that an admin edit takes effect everywhere at
once without a restart; reading raw `config` bypasses the override.

## Singleton-row persistence pattern

The overrides table is a **single row with a fixed primary key** (a constant id,
not auto-increment). Writes use an atomic upsert (`insert ... onConflictDoUpdate`
keyed on the PK), never read-then-insert.

**Why:** read-then-insert lets two concurrent first-writes both see "no row" and
both insert, producing duplicate rows; later reads then pick one arbitrarily and
config appears stuck/non-deterministic. A fixed PK + upsert makes concurrent writes
converge on one row.

**How to apply:** reuse this pattern for any other "one-row global config/state"
table in this repo. Also coerce integer columns server-side (the OpenAPI→Orval zod
emits `.number()` not `.int()` for `type: integer`, so a float can slip through and
500 on a pg integer column).
