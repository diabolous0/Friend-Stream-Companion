export function avatarSrc(url?: string | null): string | null {
  if (!url) return null;
  if (/^(https?:)?\/\//.test(url) || url.startsWith("data:")) return url;
  return `/api/storage${url}`;
}

export function initials(name?: string | null): string {
  const s = (name ?? "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export function displayNameOf(u?: { displayName?: string | null; username?: string | null } | null): string {
  return (u?.displayName?.trim() || u?.username?.trim() || "").trim();
}
