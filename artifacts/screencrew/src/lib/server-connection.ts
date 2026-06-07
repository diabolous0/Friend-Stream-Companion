import { setBaseUrl } from "@workspace/api-client-react";

// Phase 2a — client connection layer.
//
// ScreenCrew can talk to two kinds of backend:
//   1. Quick Session  — the bundled server served from the same origin as the
//      web app (the default; no server URL stored).
//   2. Self-Hosted    — a permanent community server reachable by IP / domain /
//      invite link, stored here and applied to every API + WebSocket call.
//
// When no server URL is stored we fall back to same-origin behaviour, so the
// default Replit deployment is completely unchanged.

const STORAGE_KEY = "screencrew_server_url";

export function getStoredServerUrl(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
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

export function setStoredServerUrl(input: string): string {
  const normalized = normalizeServerUrl(input);
  localStorage.setItem(STORAGE_KEY, normalized);
  applyServerConnection();
  return normalized;
}

export function clearStoredServerUrl(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  applyServerConnection();
}

// Push the current connection into the generated API client. Call once at
// startup (before the first request) and again whenever it changes.
export function applyServerConnection(): void {
  const stored = getStoredServerUrl();
  setBaseUrl(stored ?? null);
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
  const stored = getStoredServerUrl();
  if (!stored) return "Quick Session";
  try {
    return new URL(stored).host;
  } catch {
    return stored;
  }
}
