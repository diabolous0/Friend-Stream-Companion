---
name: Orval codegen quirks for ScreenCrew
description: Durable pitfalls with orval codegen in this repo — avoids broken barrel exports and stale index.ts
---

## Removing the `schemas` option from zod orval config

The `zod` output in `orval.config.ts` must NOT have `schemas: { path: "generated/types", ... }`.

**Why:** Orval generates a barrel `index.ts` that re-exports both `generated/api` (Zod schemas) and `generated/types` (TS interfaces). Both export identically-named symbols (e.g. `GetRoomMessagesParams`), causing `TS2308` ambiguous-re-export errors on `tsc --build`.

**How to apply:** Keep `schemas` option removed. The `lib/api-zod/src/index.ts` barrel should be a single line: `export * from "./generated/api";`.

## Orval does NOT regenerate index.ts on subsequent runs

With `mode: "split"`, orval generates `index.ts` at the workspace root once (when first created). On subsequent `codegen` runs with `clean: true`, only the `target` folder (`generated/`) is cleaned — the `index.ts` at workspace root is left untouched. Manual edits to `index.ts` persist across codegen runs.

**Why this matters:** If `index.ts` was generated with a stale `export * from "./generated/types"` line, it stays there even after removing the `schemas` option. Must manually fix it once; subsequent runs won't undo the fix.

## useGetRoomMessages hook arg order

Hooks for endpoints WITHOUT query params: `useGetFoo(pathParam, { query: { ... } })`
Hooks for endpoints WITH query params (e.g. `useGetRoomMessages`): `useGetRoomMessages(roomId, params?, { query: { ... } })`

Passing the TanStack Query options as the second arg (instead of undefined + options as third) causes `TS2353: Object literal may only specify known properties`.

## Old .tsx vs new .ts file conflicts

When replacing a hook file (e.g. `use-websocket.tsx` → `use-websocket.ts`), delete the old `.tsx` file. Vite resolves `.ts` before `.tsx` by default, but the old file still gets compiled as part of the graph and can cause HMR failures.
