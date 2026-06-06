---
name: WebRTC stream teardown must use refs, not state
description: Why stop/cleanup callbacks in the WebRTC hook read the live stream from a ref
---

# WebRTC media teardown

In `use-webrtc.ts`, `stopSharing`/`cleanup` (and any `track.onended` handler set inside
`startSharing`) must read the active MediaStream from a **ref** (`localStreamRef.current`),
never from the `localStream` state variable.

**Why:** these callbacks get captured in closures (the `onended` handler, and the
`room.tsx` unmount effect `useEffect(() => () => cleanup(), [])`). A state-based closure
captures a stale `localStream` (often `null` from the render before sharing started), so
teardown silently skips `track.stop()` — leaving the OS screen-capture/mic indicator on
and leaking tracks. A ref always points at the current stream regardless of which render
captured the callback. Keep the `localStream` *state* too (PCs add tracks reactively via
it), but mirror every assignment into the ref.

**How to apply:** whenever you `setLocalStream(x)`, also set `localStreamRef.current = x`.
Same pattern for the mic gain pipeline: track the raw stream + AudioContext in refs
(`micRawStreamRef`, `micCtxRef`) and stop/close them in one `teardownMic()` helper called
from both `leaveVoice` and `cleanup`.

## Media capture settings flow
Capture options live in `AppSettings` (localStorage). `lib/media.ts` turns them into
constraints/effects: `buildAudioConstraints`/`buildDisplayConstraints` feed
getUserMedia/getDisplayMedia; mic volume is a Web Audio GainNode
(source→gain→MediaStreamDestination, the dest.stream is what's sent over WebRTC);
codec preference uses `RTCRtpTransceiver.setCodecPreferences` (set before createOffer);
max bitrate uses `RTCRtpSender.setParameters` (set after setLocalDescription). All of
these are best-effort and wrapped in try/catch — browsers may ignore unsupported codecs.
Mic/video changes only take effect on the *next* joinVoice/startSharing (documented in UI).
