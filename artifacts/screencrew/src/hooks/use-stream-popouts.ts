import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Manages detached browser windows (window.open) that mirror live screen-share
 * streams. Each popout is keyed by the streamer's user id, lets the viewer drag
 * the stream onto a second monitor, and is natively resizable. Audio is left
 * muted in the popout so it keeps playing through the main app (no echo).
 */
export function useStreamPopouts() {
  const winsRef = useRef<Map<number, Window>>(new Map());
  const videosRef = useRef<Map<number, HTMLVideoElement>>(new Map());
  const [openIds, setOpenIds] = useState<number[]>([]);

  const close = useCallback((id: number) => {
    const w = winsRef.current.get(id);
    if (w && !w.closed) w.close();
    winsRef.current.delete(id);
    videosRef.current.delete(id);
    setOpenIds(ids => ids.filter(x => x !== id));
  }, []);

  const open = useCallback((id: number, stream: MediaStream | null, title: string) => {
    const existing = winsRef.current.get(id);
    if (existing && !existing.closed) { existing.focus(); return; }
    const w = window.open("", `screencrew_stream_${id}`, "width=960,height=600");
    if (!w) return; // popup blocked
    const doc = w.document;
    doc.title = title;
    Object.assign(doc.body.style, {
      margin: "0", height: "100vh", background: "#0a0a0f",
      display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
    } as Partial<CSSStyleDeclaration>);
    const video = doc.createElement("video");
    video.autoplay = true;
    video.muted = true; // audio continues in the main app to avoid echo
    video.playsInline = true;
    Object.assign(video.style, {
      width: "100%", height: "100%", objectFit: "contain", background: "#0a0a0f",
    } as Partial<CSSStyleDeclaration>);
    if (stream) video.srcObject = stream;
    doc.body.appendChild(video);
    void video.play?.().catch(() => {});
    winsRef.current.set(id, w);
    videosRef.current.set(id, video);
    setOpenIds(ids => (ids.includes(id) ? ids : [...ids, id]));
  }, []);

  /** Keep each open popout's video bound to its current live stream. */
  const updateStreams = useCallback((streamsById: Record<number, MediaStream | null | undefined>) => {
    videosRef.current.forEach((video, id) => {
      const s = streamsById[id] ?? null;
      if (video.srcObject !== s) {
        video.srcObject = s;
        if (s) void video.play?.().catch(() => {});
      }
    });
  }, []);

  // Detect popups the user closed manually so buttons reflect the real state.
  useEffect(() => {
    if (openIds.length === 0) return;
    const iv = setInterval(() => {
      let changed = false;
      winsRef.current.forEach((w, id) => {
        if (w.closed) { winsRef.current.delete(id); videosRef.current.delete(id); changed = true; }
      });
      if (changed) setOpenIds(Array.from(winsRef.current.keys()));
    }, 800);
    return () => clearInterval(iv);
  }, [openIds.length]);

  // Close every popout when the host unmounts (e.g. leaving the room).
  useEffect(() => {
    const wins = winsRef.current;
    const videos = videosRef.current;
    return () => {
      wins.forEach(w => { if (!w.closed) w.close(); });
      wins.clear();
      videos.clear();
    };
  }, []);

  return useMemo(() => ({ open, close, updateStreams, openIds }), [open, close, updateStreams, openIds]);
}
