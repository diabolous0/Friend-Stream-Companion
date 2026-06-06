import { useState, useCallback, useRef, useEffect } from "react";

interface UseVoiceActivityOptions {
  onSpeakingChange: (speaking: boolean) => void;
  threshold?: number;
  silenceDelay?: number;
}

export function useVoiceActivity({
  onSpeakingChange,
  threshold = 15,
  silenceDelay = 600,
}: UseVoiceActivityOptions) {
  const [isActive, setIsActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSpeakingRef = useRef(false);
  const onSpeakingChangeRef = useRef(onSpeakingChange);

  useEffect(() => {
    onSpeakingChangeRef.current = onSpeakingChange;
  }, [onSpeakingChange]);

  const stopDetection = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    isSpeakingRef.current = false;
    setIsSpeaking(false);
    setIsActive(false);
    onSpeakingChangeRef.current(false);
  }, []);

  const startDetection = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      setHasPermission(true);

      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);

        if (rms > threshold) {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true;
            setIsSpeaking(true);
            onSpeakingChangeRef.current(true);
          }
        } else {
          if (isSpeakingRef.current && !silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              isSpeakingRef.current = false;
              setIsSpeaking(false);
              onSpeakingChangeRef.current(false);
              silenceTimerRef.current = null;
            }, silenceDelay);
          }
        }

        animFrameRef.current = requestAnimationFrame(tick);
      };

      setIsActive(true);
      animFrameRef.current = requestAnimationFrame(tick);
    } catch {
      setHasPermission(false);
      setIsActive(false);
    }
  }, [threshold, silenceDelay]);

  useEffect(() => {
    return () => {
      stopDetection();
    };
  }, [stopDetection]);

  return { isActive, isSpeaking, hasPermission, startDetection, stopDetection };
}
