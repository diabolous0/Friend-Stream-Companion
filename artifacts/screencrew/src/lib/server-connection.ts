import { setBaseUrl } from "@workspace/api-client-react";

// Client connection layer — multi-backend.
//
// ScreenCrew can talk to several backends and remembers them as a list:
//   1. Quick Session  — the bundled server served from the same origin as the
//      web app (the built-in default; url === null).
//   2. Self-Hosted    — permanent community servers reachable by IP / domain /
//      invite link, saved here and switchable from the server rail.
//
// Each backend keeps its OWN auth token (accounts don't carry across servers),
// its own set of favorite rooms, etc. The "active" backend is what every API +
// WebSocket call targets. When the active backend is Quick Session we fall back
// to same-origin behaviour, so the default Replit deployment is unchanged.

export interface SavedServer {
  id: string;
  label: string;
  url: string | null; // null === Quick Session (same origin)
  lastUsedAt?: number;
}

const SERVERS_KEY = "screencrew_servers";
const ACTIVE_KEY = "screencrew_active_server";
const LEGACY_URL_KEY = "screencrew_server_url";
const LEGACY_TOKEN_KEY = "screencrew_token";
const QUICK_CALL_TOKEN_KEY = "lynxdock_quick_call_token";

export const QUICK_SESSION_ID = "quick";

const QUICK_SESSION: SavedServer = {
  id: QUICK_SESSION_ID,
  label: "Quick Session",
  url: null,
};

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// Accepts "1.2.3.4:8080", "myserver.com", "https://host/path", etc.
// Returns the normalized HTTP base: scheme + host + optional path, no trailing
// slash, query/hash stripped. Throws if the address can't be parsed.
export function normalizeServerUrl(input: string): string {
  let raw = input.trim();
  if (!raw) throw new Error("Server address is required");
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  const url = new URL(raw);
  const base = `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
  return base;
}

function labelForUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ─── One-time migration from the single-server scheme ────────────────────────
function migrateIfNeeded(): void {
  if (safeGet(SERVERS_KEY) != null) return; // already migrated
  const legacyUrl = safeGet(LEGACY_URL_KEY);
  if (legacyUrl) {
    let normalized: string;
    try {
      normalized = normalizeServerUrl(legacyUrl);
    } catch {
      normalized = legacyUrl;
    }
    const server: SavedServer = { id: normalized, label: labelForUrl(normalized), url: normalized };
    safeSet(SERVERS_KEY, JSON.stringify([server]));
    safeSet(ACTIVE_KEY, server.id);
    // The existing token (if any) belonged to whatever was active — the
    // self-hosted server — so move it to that server's per-backend key.
    const legacyToken = safeGet(LEGACY_TOKEN_KEY);
    if (legacyToken) {
      safeSet(tokenKey(server.id), legacyToken);
      safeRemove(LEGACY_TOKEN_KEY);
    }
    safeRemove(LEGACY_URL_KEY);
  } else {
    safeSet(SERVERS_KEY, JSON.stringify([]));
    safeSet(ACTIVE_KEY, QUICK_SESSION_ID);
  }
}

// ─── Saved servers ───────────────────────────────────────────────────────────
function readStoredServers(): SavedServer[] {
  const raw = safeGet(SERVERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SavedServer =>
        s && typeof s.id === "string" && typeof s.label === "string",
    );
  } catch {
    return [];
  }
}

// Always returns Quick Session first, then saved self-hosted servers.
export function getSavedServers(): SavedServer[] {
  migrateIfNeeded();
  return [QUICK_SESSION, ...readStoredServers()];
}

export function addSavedServer(input: string, label?: string): SavedServer {
  migrateIfNeeded();
  const url = normalizeServerUrl(input);
  const id = url;
  const existing = readStoredServers();
  const found = existing.find((s) => s.id === id);
  const cleanLabel = label?.trim();
  if (found) {
    const server = cleanLabel ? { ...found, label: cleanLabel, lastUsedAt: Date.now() } : found;
    if (cleanLabel) {
      safeSet(SERVERS_KEY, JSON.stringify(existing.map((s) => s.id === id ? server : s)));
    }
    return server;
  }
  const server: SavedServer = { id, label: cleanLabel || labelForUrl(url), url, lastUsedAt: Date.now() };
  safeSet(SERVERS_KEY, JSON.stringify([...existing, server]));
  return server;
}

export function getRecentServers(limit = 4): SavedServer[] {
  migrateIfNeeded();
  return readStoredServers()
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, limit);
}

export function removeSavedServer(id: string): void {
  if (id === QUICK_SESSION_ID) return;
  const existing = readStoredServers().filter((s) => s.id !== id);
  safeSet(SERVERS_KEY, JSON.stringify(existing));
  safeRemove(tokenKey(id));
  if (getActiveServerId() === id) setActiveServerId(QUICK_SESSION_ID);
}

// ─── Active server ───────────────────────────────────────────────────────────
export function getActiveServerId(): string {
  migrateIfNeeded();
  return safeGet(ACTIVE_KEY) ?? QUICK_SESSION_ID;
}

export function getActiveServer(): SavedServer {
  const id = getActiveServerId();
  return getSavedServers().find((s) => s.id === id) ?? QUICK_SESSION;
}

// Emitted whenever the active backend changes, so per-backend client stores
// (e.g. favorites) can re-read deterministically instead of relying on
// incidental re-renders.
export const SERVER_CHANGED_EVENT = "screencrew:server-changed";

export function setActiveServerId(id: string): void {
  if (id !== QUICK_SESSION_ID) {
    const existing = readStoredServers();
    const next = existing.map((server) =>
      server.id === id ? { ...server, lastUsedAt: Date.now() } : server,
    );
    safeSet(SERVERS_KEY, JSON.stringify(next));
  }
  safeSet(ACTIVE_KEY, id);
  applyServerConnection();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SERVER_CHANGED_EVENT));
  }
}

// ─── Per-backend auth tokens ─────────────────────────────────────────────────
function tokenKey(serverId: string): string {
  return serverId === QUICK_SESSION_ID
    ? LEGACY_TOKEN_KEY
    : `screencrew_token__${serverId}`;
}

export function getActiveToken(): string | null {
  try {
    const quickCallToken = sessionStorage.getItem(QUICK_CALL_TOKEN_KEY);
    if (quickCallToken) return quickCallToken;
  } catch {
    /* ignore */
  }
  return safeGet(tokenKey(getActiveServerId()));
}

export function setActiveToken(token: string): void {
  safeSet(tokenKey(getActiveServerId()), token);
}

export function clearActiveToken(): void {
  safeRemove(tokenKey(getActiveServerId()));
}

export function setQuickCallToken(token: string): void {
  try {
    sessionStorage.setItem(QUICK_CALL_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearQuickCallToken(): void {
  try {
    sessionStorage.removeItem(QUICK_CALL_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// ─── Back-compat URL helpers (now driven by the active server) ───────────────
export function getStoredServerUrl(): string | null {
  return getActiveServer().url;
}

// Kept for the connect-server page: save + activate a self-hosted server.
export function setStoredServerUrl(input: string, label?: string): string {
  const server = addSavedServer(input, label);
  setActiveServerId(server.id);
  return server.url ?? "";
}

// Kept for the connect-server page: switch back to Quick Session.
export function clearStoredServerUrl(): void {
  setActiveServerId(QUICK_SESSION_ID);
}

// Push the current connection into the generated API client. Call once at
// startup (before the first request) and again whenever it changes.
export function applyServerConnection(): void {
  setBaseUrl(getActiveServer().url ?? null);
}

// WebSocket endpoint for the active server. Self-hosted derives ws(s):// from
// the stored HTTP base; Quick Session uses the current page origin.
export function getWebSocketUrl(): string {
  const stored = getStoredServerUrl();
  if (stored) {
    const u = new URL(stored);
    const proto = u.protocol === "https:" ? "wss:" : "ws:";
    const base = `${proto}//${u.host}${u.pathname}`.replace(/\/+$/, "");
    return `${base}/api/ws`;
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws`;
}

// Resolve an API path against the active server. Absolute http(s) URLs (e.g.
// signed cloud upload URLs) pass through unchanged; relative "/api/..." paths
// get the self-hosted server base prepended (or stay relative for same-origin).
export function apiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const stored = getStoredServerUrl();
  if (!stored) return pathOrUrl;
  const suffix = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${stored}${suffix}`;
}

// True when the given upload URL targets our own server (relative path) rather
// than an external signed cloud URL — i.e. it needs our auth header.
export function isSameServerUrl(pathOrUrl: string): boolean {
  return !/^https?:\/\//i.test(pathOrUrl);
}

// Human-friendly label for the active connection (for UI display).
export function getServerLabel(): string {
  return getActiveServer().label;
}
