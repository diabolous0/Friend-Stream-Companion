import { useRef, useCallback } from "react";
import type { AppSettings, SoundEvent } from "@/lib/settings";

type ToneStep = { freq: number; dur: number; vol: number; delay: number };

const BUILTIN_TONES: Record<string, ToneStep[]> = {
  beep: [{ freq: 880, dur: 0.09, vol: 0.12, delay: 0 }],
  chime: [
    { freq: 1047, dur: 0.1, vol: 0.08, delay: 0 },
    { freq: 1319, dur: 0.13, vol: 0.06, delay: 0.07 },
  ],
  pop: [{ freq: 660, dur: 0.06, vol: 0.12, delay: 0 }],
  join: [
    { freq: 523, dur: 0.08, vol: 0.06, delay: 0 },
    { freq: 659, dur: 0.1, vol: 0.07, delay: 0.08 },
  ],
};

export function useSounds(settings: AppSettings) {
  const ctxRef = useRef<AudioContext | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const playTone = useCallback((steps: ToneStep[]) => {
    try {
      if (!ctxRef.current) ctxRef.current = new AudioContext();
      const ctx = ctxRef.current;
      for (const step of steps) {
        const t = ctx.currentTime + step.delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = step.freq;
        gain.gain.setValueAtTime(step.vol, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + step.dur);
        osc.start(t);
        osc.stop(t + step.dur);
      }
    } catch {}
  }, []);

  // Resolve and play a sound by its id. Respects soundEnabled unless `force`.
  const playSound = useCallback((soundId: string, force = false) => {
    const s = settingsRef.current;
    if (!force && !s.soundEnabled) return;
    if (!soundId || soundId === "none") return;

    if (soundId.startsWith("custom:")) {
      const id = soundId.slice("custom:".length);
      const custom = s.customSounds.find((c) => c.id === id);
      if (!custom) return;
      try {
        const audio = new Audio(`/api/storage${custom.objectPath}`);
        audio.volume = 0.7;
        void audio.play();
      } catch {}
      return;
    }

    // Shared soundboard clip: `url:<objectPath>` fetched from shared storage
    if (soundId.startsWith("url:")) {
      const objectPath = soundId.slice("url:".length);
      if (!objectPath) return;
      try {
        const src = objectPath.startsWith("http") ? objectPath : `/api/storage${objectPath}`;
        const audio = new Audio(src);
        audio.volume = 0.7;
        void audio.play();
      } catch {}
      return;
    }

    const steps = BUILTIN_TONES[soundId];
    if (steps) playTone(steps);
  }, [playTone]);

  // Play the sound configured for an event type.
  const playEvent = useCallback((event: SoundEvent) => {
    const s = settingsRef.current;
    playSound(s.eventSounds[event] ?? "none");
  }, [playSound]);

  // Play a user-specific sound if one is set, otherwise fall back to the event sound.
  const playForUser = useCallback((userId: number | string, event: SoundEvent) => {
    const s = settingsRef.current;
    const override = s.userSounds[String(userId)];
    if (override) playSound(override);
    else playEvent(event);
  }, [playSound, playEvent]);

  return { playEvent, playForUser, playSound };
}
