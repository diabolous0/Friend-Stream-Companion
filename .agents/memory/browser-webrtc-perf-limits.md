---
name: Browser WebRTC perf goal limits
description: Which screen-share/voice performance goals are achievable vs only hint-able in a browser tab (no Electron/native).
---

ScreenCrew is a plain browser tab, not Electron/native. When the user asks for
performance goals, know what is actually controllable from JS:

**Achievable / real knobs:**
- Adjustable quality — `getDisplayMedia` constraints (width/height/frameRate) + sender `maxBitrate`.
- CPU-vs-quality tradeoff — sender `degradationPreference` (`maintain-framerate` for gameplay) and track `contentHint` (`motion`/`detail`).
- Low-latency voice — audio receiver `playoutDelayHint = 0` (smaller jitter buffer; quality tradeoff on bad links).
- Auto-reconnect — own the WS lifecycle: backoff+jitter, guard OPEN/CONNECTING, `closedRef` to stop reconnect-after-unmount, wake on `online`/`visibilitychange`.
- Minimal animations — `reduceMotion` setting + `.reduce-motion` kill-switch CSS, honoring `prefers-reduced-motion`.

**Only hint-able, NOT guaranteeable:**
- Hardware encoding — you can only *prefer* a codec (`setCodecPreferences`); the browser decides HW vs SW. H264 is the most commonly HW-accelerated. Don't promise "hardware encoding on."
- "Works while games fullscreen" — capture continues, but a hidden/background tab is subject to browser throttling. No JS flag forces foreground priority.
- No Electron footprint — inherently satisfied by being a tab; nothing to build.

**Why:** future "make it faster" requests should target the real knobs above and
not chase guarantees the browser sandbox does not expose.
