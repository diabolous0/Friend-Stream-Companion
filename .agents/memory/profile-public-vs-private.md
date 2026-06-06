---
name: Profile field privacy & live identity
description: How user profile fields are split public vs private across API surfaces, and why WS-cached identity must be refreshed on profile update.
---

# Profile fields: public vs private, and live identity

The `User` schema carries both private fields (`email`, `steamUrl`, `discordUrl`) and
public ones (`username`, `displayName`, `avatarUrl`). `GET /users/me` returns the full
`User` (self only). Any surface that exposes *other* users — room members, presence,
chat message authors — must use the `PublicUser` schema (id, username, displayName,
avatarUrl, createdAt), never `User`.

**Why:** The OpenAPI spec is the authoritative contract for generated clients. Even if a
route handler hand-selects only safe columns at runtime, pointing the endpoint at `User`
in the spec leaks `email`/socials into generated types and invites future leaks. Keep
the contract honest: members endpoint → `PublicUser`.

**How to apply:** When adding a private profile field, add it ONLY to `User` and
`UpdateProfileInput`. Do not add it to `PublicUser`, `PresenceEntry`, or `Message`. Verify
the members/presence/messages selects and their schema refs stay public-only.

## Live identity goes stale without a refresh hook

The WS signaling layer caches `displayName`/`avatarUrl` in per-connection `ClientState`
at auth time. Presence broadcasts and `new_message` payloads read this cache. After
`PATCH /users/me`, connected peers keep seeing the *old* name/avatar until the user
reconnects.

**Why:** ClientState is populated once at WS auth and never re-read from the DB.

**How to apply:** After a successful profile update, call the signaling helper that
rewrites cached ClientState for that userId across all their sockets and re-broadcasts
presence to their rooms. Any future field surfaced through ClientState needs the same
refresh-on-update treatment.
