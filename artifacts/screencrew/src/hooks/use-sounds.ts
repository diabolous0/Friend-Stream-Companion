import { useRef, useCallback } from "react";

export function useSounds(muted: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const tone = useCallback((freq: number, dur: number, vol: number, delay = 0) => {
    if (mutedRef.current) return;
    try {
      if (!ctxRef.current) ctxRef.current = new AudioContext();
      const ctx = ctxRef.current;
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t);
      osc.stop(t + dur);
    } catch {
    }
  }, []);

  const playMessage = useCallback(() => {
    tone(880, 0.09, 0.12);
  }, [tone]);

  const playReaction = useCallback(() => {
    tone(1047, 0.1, 0.08, 0);
    tone(1319, 0.13, 0.06, 0.07);
  }, [tone]);

  const playJoin = useCallback(() => {
    tone(523, 0.08, 0.06, 0);
    tone(659, 0.1, 0.07, 0.08);
  }, [tone]);

  return { playMessage, playReaction, playJoin };
}
