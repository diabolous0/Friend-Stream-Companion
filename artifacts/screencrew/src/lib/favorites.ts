import { useSyncExternalStore } from "react";
import { getActiveServerId, SERVER_CHANGED_EVENT } from "@/lib/server-connection";

// Favorite rooms are tracked per-backend, since room IDs only mean something
// within a single server. Stored as a JSON array of room IDs under a key
// namespaced by the active server.
//
// Exposed as a tiny external store so any component (the rooms list and the
// nav column live in different parts of the tree) stays in sync when a room is
// favorited / unfavorited.

function favKey(): string {
  return `screencrew_favrooms__${getActiveServerId()}`;
}

const listeners = new Set<() => void>();

// Cache so getSnapshot returns a stable reference until the underlying data
// (or the active server) actually changes — required by useSyncExternalStore.
let cached: number[] = [];
let cachedKey = "";
let cachedRaw: string | null = "\u0000"; // sentinel: force first compute

function parse(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function compute(): number[] {
  const key = favKey();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    raw = null;
  }
  if (key === cachedKey && raw === cachedRaw) return cached;
  cachedKey = key;
  cachedRaw = raw;
  cached = parse(raw);
  return cached;
}

function emit() {
  listeners.forEach((l) => l());
}

// When the active backend changes, the namespaced key changes too, so notify
// subscribers deterministically rather than relying on incidental re-renders.
if (typeof window !== "undefined") {
  window.addEventListener(SERVER_CHANGED_EVENT, () => emit());
}

export function getFavoriteRoomIds(): number[] {
  return compute();
}

export function isFavoriteRoom(roomId: number): boolean {
  return compute().includes(roomId);
}

// Toggles favorite state and returns the new state (true === now favorited).
export function toggleFavoriteRoom(roomId: number): boolean {
  const current = compute();
  const exists = current.includes(roomId);
  const next = exists ? current.filter((id) => id !== roomId) : [...current, roomId];
  try {
    localStorage.setItem(favKey(), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  emit();
  return !exists;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// React hook — re-renders whenever the active server's favorites change.
export function useFavoriteRoomIds(): number[] {
  return useSyncExternalStore(subscribe, compute, compute);
}
