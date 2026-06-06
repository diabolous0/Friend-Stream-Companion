---
name: CSS order vs ARIA in e2e tests
description: Why panel-swap (CSS flex `order`) e2e checks give false negatives, and how to verify them.
---

CSS `order` (and `flex-direction: row-reverse`, grid placement, etc.) changes only the **visual** position of flex/grid children. It does NOT change DOM source order, so the accessibility/ARIA tree still reports the original order.

**Why this matters:** the Playwright testing subagent often reads the ARIA snapshot to judge layout. For any feature implemented via CSS `order`, the ARIA tree is a false signal and will report "no swap" even when the swap is visually correct.

**How to apply:** when testing CSS-`order`-based reordering (e.g. ScreenCrew's Layout → "Top panel" Crew/Chat swap), instruct the test to (1) close any covering modal first, (2) judge ONLY by the rendered screenshot's visual top/bottom positions, and explicitly tell it to ignore the ARIA tree. ScreenCrew's swap lives in `room.tsx`: friends/divider/chat are siblings in a `flex flex-col` container, each with an inline `style={{ order }}` driven by `settings.panelOrder`.
