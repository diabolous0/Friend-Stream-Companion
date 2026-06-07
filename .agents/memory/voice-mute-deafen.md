---
name: Voice mute/deafen vs VAD presence
description: Why self-mute/deafen must gate speaking-presence broadcasts, not just the mic track.
---

# Mute/deafen must gate speaking presence, not only the mic

Voice activity detection (the VAD loop) runs independently of mute/deafen. Disabling the
outbound mic track (`setMicEnabled(false)`) stops audio but does NOT stop the VAD loop from
firing `onSpeakingChange(true)`, so a muted/deafened user still broadcasts `speaking: true`
presence and shows as talking to the crew.

**Rule:** any "silenced" state (self-mute OR deafen) must also suppress the speaking-presence
broadcast. The speaking callback is a stable `useCallback` with empty deps, so read the silenced
state through a ref (`micSilencedRef`), not a closed-over value. Also force `speaking:false` once
in an effect the moment you become silenced (the VAD won't emit a fresh `false` on its own).

**Why:** mute/deafen, the mic track, and VAD are three separate concerns; turning off one does
not turn off the others.

**How to apply:** when touching mute/deafen, voice-mode (open/ptt), or the VAD hook, verify the
speaking indicator clears. Deafen implies mic-off too (`micSilenced = selfMuted || deafened`).
Toggle hotkeys need `if (e.repeat) return;` or a held key oscillates the toggle.
