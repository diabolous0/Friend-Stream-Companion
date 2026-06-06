---
name: Vite new-dep optimize crash
description: Why a brand-new Radix/React dependency throws a null-useMemo runtime error on first load, and how to clear it.
---

When you add a new dependency that ships its own React-context hooks (e.g. `@radix-ui/react-popover`, `@radix-ui/react-hover-card`), the Vite dev server runs a one-time dependency re-optimization. The HMR reload that happens mid-session can throw:

```
Cannot read properties of null (reading 'useMemo')
An error occurred in the <Popover> component.
```

**Why:** during the re-optimize+reload the page transiently holds two React module instances / a half-loaded dep graph, so a hook reads a null React internals object. It is a stale-state artifact, NOT a real "multiple copies of React" bug.

**How to apply:** don't chase it as a code bug. Restart the affected web workflow (`restart_workflow "<artifact>: web"`) to rebuild a clean optimized bundle, then re-verify. If it persists after a clean restart, only then investigate duplicate React installs.
