---
name: Drop-in voice channels
description: Non-obvious constraints for cross-room voice presence and one-click voice join in ScreenCrew.
---

# Drop-in voice channels

Discord-style casual voice: rooms list shows who is in voice; one click drops you into a voice channel with mic on.

## Cross-room voice presence is in-memory only
- Voice presence lives in the WebSocket signaling `clients` map (in-memory), NOT the DB. `GET /rooms` enriches each room with `voiceMembers[]` by calling a signaling helper that scans that map.
- **Dedupe by `${roomId}:${userId}`** when building the occupant list — one user can hold multiple sockets (e.g. two tabs) and would otherwise be double-counted in the "N in voice" badge and avatar row.
- Scope the scan to the caller's room IDs (compute memberships first) so there is no cross-room presence leakage.

## WS join_channel resets server-side inVoice to false
- **Why:** moving between voice channels (or arriving via `?voice=`) re-sends `join_channel`, which the server treats as a fresh channel context and clears `inVoice`.
- **How to apply:** to switch voice channels you must leave-then-rejoin: leave current voice, switch channel, then re-assert `presence(inVoice:true)`. Use a `pendingVoiceJoinRef` + an effect that fires once `connected && activeChannel === target && !isInVoice`.

## Auto-join effect ordering (avoid use-before-declare)
- The auto-join effect runs before `handleJoinVoice` is declared in the component body, so call it through a ref (`handleJoinVoiceRef.current`) to avoid TDZ/stale-closure issues.
- `getUserMedia` on auto-join after navigation works once mic permission is granted (persists); first time may prompt — acceptable. Failure returns null and never sends `inVoice:true`, so it fails safe.

## Model consistency
- Switching to a NON-voice channel while in voice should leave voice, keeping the "you're only in voice if you're in a voice channel" model intact.
