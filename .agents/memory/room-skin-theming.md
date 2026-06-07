---
name: Room skin theming
description: How room-level (creator-set) skins are applied without conflicting with each user's personal theme.
---

# Room skin theming

Room-level skins (a full palette/font/radius the room creator picks, stored in `rooms.themeSkin`) are applied by setting CSS custom-property vars on the **room window container element** (a ref), never on `document.documentElement`.

**Why:** The settings provider's global `apply()` writes the user's personal theme vars onto `document.documentElement`. React effects fire bottom-up (child before parent/provider), so if a room skin also wrote to documentElement the provider's apply() would overwrite it. Scoping skin vars to the window container makes them cascade to the whole room subtree and win there, while leaving the global theme untouched — no ordering fight, clean restore on cleanup/unset.

**How to apply:** Reuse `applySkinVars(el, colors)` / `clearSkinVars(el)` exported from `lib/settings.tsx` (shared with the global custom theme). Effect keyed on `room?.themeSkin`; also set `--radius` and `--app-font-sans/mono` from the preset, and remove all of them in cleanup. Trade-off: content rendered in portals (modals, toasts, the floating stream window) is outside the container and won't pick up the room skin — acceptable, the main window is what matters.
