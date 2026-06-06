import { useEffect, useRef } from "react";

// Live frequency-bar visualizer driven by a MediaStream's audio.
// When no stream is supplied (or analysis is unavailable) it falls back to a
// gentle idle bounce so speaking avatars still feel alive.

const BAR_COUNT = 7;

export function Spectrum({
  stream,
  active = true,
  bars = BAR_COUNT,
  height = 12,
  color = "var(--primary)",
  className = "",
}: {
  stream?: MediaStream | null;
  active?: boolean;
  bars?: number;
  height?: number;
  color?: string;
  className?: string;
}) {
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      for (const el of barRefs.current) if (el) el.style.height = "2px";
      return;
    }

    const hasAudio = !!stream && stream.getAudioTracks().length > 0;

    // Idle fallback — animated sine bounce, no audio graph.
    if (!hasAudio) {
      let t = 0;
      const tick = () => {
        t += 0.18;
        barRefs.current.forEach((el, i) => {
          if (!el) return;
          const v = (Math.sin(t + i * 0.9) + 1) / 2;
          el.style.height = `${2 + v * (height - 2)}px`;
        });
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }

    let ctx: AudioContext | null = null;
    let src: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let cancelled = false;

    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AC();
      src = ctx.createMediaStreamSource(stream!);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.7;
      src.connect(analyser);
    } catch {
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (cancelled || !analyser) return;
      analyser.getByteFrequencyData(data);
      const step = Math.floor(data.length / bars) || 1;
      barRefs.current.forEach((el, i) => {
        if (!el) return;
        const v = (data[i * step] ?? 0) / 255;
        el.style.height = `${2 + v * (height - 2)}px`;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { src?.disconnect(); analyser?.disconnect(); ctx?.close(); } catch { /* ignore */ }
    };
  }, [stream, active, bars, height]);

  return (
    <div className={`flex items-end gap-px shrink-0 ${className}`} style={{ height }}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          ref={(el) => { barRefs.current[i] = el; }}
          className="w-0.5 rounded-full"
          style={{ height: 2, background: color }}
        />
      ))}
    </div>
  );
}
