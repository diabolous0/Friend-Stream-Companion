import { useState, useCallback, useRef, useEffect } from "react";
import { applyCodecPreference, applyVideoBitrate } from "@/lib/media";
import type { VideoCodec } from "@/lib/settings";

interface ShareConfig {
  displayConstraints?: MediaStreamConstraints;
  codec?: VideoCodec;
  bitrate?: number;
}

interface VoiceConfig {
  audioConstraints?: MediaTrackConstraints | boolean;
  gain?: number;
}

export function useWebRTC(
  wsSend: (message: any) => void,
  onStreamStart?: () => void,
  onStreamStop?: () => void
) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<number, MediaStream>>({});
  const [remoteAudioStreams, setRemoteAudioStreams] = useState<Record<number, MediaStream>>({});
  const [isSharing, setIsSharing] = useState(false);
  const [isInVoice, setIsInVoice] = useState(false);

  const screenPCsRef = useRef<Record<number, RTCPeerConnection>>({});
  const audioPCsRef = useRef<Record<number, RTCPeerConnection>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micRawStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const videoCfgRef = useRef<{ codec: VideoCodec; bitrate: number }>({ codec: "auto", bitrate: 0 });
  const wsSendRef = useRef(wsSend);
  wsSendRef.current = wsSend;

  const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  // ─── Screen share PCs ───────────────────────────────────────────────────────

  const getScreenPC = useCallback((userId: number) => {
    if (!screenPCsRef.current[userId]) {
      const pc = new RTCPeerConnection(ICE);
      pc.onicecandidate = (e) => {
        if (e.candidate) wsSendRef.current({ type: "ice_candidate", to: userId, candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        setRemoteStreams(prev => ({ ...prev, [userId]: e.streams[0] }));
      };
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
          setRemoteStreams(prev => { const n = { ...prev }; delete n[userId]; return n; });
        }
      };
      if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        applyCodecPreference(pc, videoCfgRef.current.codec);
      }
      screenPCsRef.current[userId] = pc;
    }
    return screenPCsRef.current[userId];
  }, [localStream]);

  const startSharing = useCallback(async (_roomId: number, config?: ShareConfig) => {
    try {
      videoCfgRef.current = { codec: config?.codec ?? "auto", bitrate: config?.bitrate ?? 0 };
      const constraints = config?.displayConstraints ?? { video: true, audio: true };
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsSharing(true);
      onStreamStart?.();
      stream.getVideoTracks()[0].onended = () => stopSharing();
    } catch (e) {
      console.error("Failed to start screen share", e);
    }
  }, [onStreamStart]);

  const stopSharing = useCallback(() => {
    Object.values(screenPCsRef.current).forEach(pc => pc.close());
    screenPCsRef.current = {};
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    setLocalStream(null);
    setIsSharing(false);
    setRemoteStreams({});
    onStreamStop?.();
  }, [onStreamStop]);

  const handleOffer = useCallback(async (from: number, sdp: string) => {
    const pc = getScreenPC(from);
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsSendRef.current({ type: "stream_answer", to: from, sdp: answer.sdp });
  }, [getScreenPC]);

  const handleAnswer = useCallback(async (from: number, sdp: string) => {
    const pc = getScreenPC(from);
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }));
  }, [getScreenPC]);

  const handleIceCandidate = useCallback(async (from: number, candidate: RTCIceCandidateInit) => {
    const pc = getScreenPC(from);
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  }, [getScreenPC]);

  const sendOffer = useCallback(async (to: number) => {
    const pc = getScreenPC(to);
    applyCodecPreference(pc, videoCfgRef.current.codec);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await applyVideoBitrate(pc, videoCfgRef.current.bitrate);
    wsSendRef.current({ type: "stream_offer", to, sdp: offer.sdp });
  }, [getScreenPC]);

  // ─── Audio call PCs ─────────────────────────────────────────────────────────

  const getAudioPC = useCallback((userId: number) => {
    if (!audioPCsRef.current[userId]) {
      const pc = new RTCPeerConnection(ICE);
      pc.onicecandidate = (e) => {
        if (e.candidate) wsSendRef.current({ type: "audio_ice", to: userId, candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        if (e.streams[0]) setRemoteAudioStreams(prev => ({ ...prev, [userId]: e.streams[0] }));
      };
      pc.oniceconnectionstatechange = () => {
        if (["disconnected", "failed", "closed"].includes(pc.iceConnectionState)) {
          setRemoteAudioStreams(prev => { const n = { ...prev }; delete n[userId]; return n; });
        }
      };
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => pc.addTrack(t, micStreamRef.current!));
      }
      audioPCsRef.current[userId] = pc;
    }
    return audioPCsRef.current[userId];
  }, []);

  const joinVoice = useCallback(async (config?: VoiceConfig): Promise<MediaStream | null> => {
    try {
      const audio = config?.audioConstraints ?? true;
      const raw = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      const gain = config?.gain ?? 100;
      let outStream = raw;
      if (gain !== 100) {
        try {
          const ctx = new AudioContext();
          const src = ctx.createMediaStreamSource(raw);
          const gainNode = ctx.createGain();
          gainNode.gain.value = gain / 100;
          const dest = ctx.createMediaStreamDestination();
          src.connect(gainNode);
          gainNode.connect(dest);
          micCtxRef.current = ctx;
          micRawStreamRef.current = raw;
          outStream = dest.stream;
        } catch {
          outStream = raw;
        }
      }
      micStreamRef.current = outStream;
      setIsInVoice(true);
      return outStream;
    } catch {
      return null;
    }
  }, []);

  const teardownMic = useCallback(() => {
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    if (micRawStreamRef.current) { micRawStreamRef.current.getTracks().forEach(t => t.stop()); micRawStreamRef.current = null; }
    if (micCtxRef.current) { micCtxRef.current.close().catch(() => {}); micCtxRef.current = null; }
  }, []);

  const leaveVoice = useCallback(() => {
    teardownMic();
    Object.values(audioPCsRef.current).forEach(pc => pc.close());
    audioPCsRef.current = {};
    setRemoteAudioStreams({});
    setIsInVoice(false);
  }, [teardownMic]);

  const sendAudioOffer = useCallback(async (to: number) => {
    const pc = getAudioPC(to);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsSendRef.current({ type: "audio_offer", to, sdp: offer.sdp });
  }, [getAudioPC]);

  const handleAudioOffer = useCallback(async (from: number, sdp: string) => {
    const pc = getAudioPC(from);
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsSendRef.current({ type: "audio_answer", to: from, sdp: answer.sdp });
  }, [getAudioPC]);

  const handleAudioAnswer = useCallback(async (from: number, sdp: string) => {
    const pc = getAudioPC(from);
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }));
  }, [getAudioPC]);

  const handleAudioIce = useCallback(async (from: number, candidate: RTCIceCandidateInit) => {
    const pc = getAudioPC(from);
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  }, [getAudioPC]);

  // Enable/disable the local mic track (push-to-talk / mute)
  const setMicEnabled = useCallback((enabled: boolean) => {
    micStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = enabled; });
    micRawStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = enabled; });
  }, []);

  // Per-peer connection quality from WebRTC stats (screen + audio PCs combined)
  const getConnectionStats = useCallback(async (): Promise<Record<number, "good" | "ok" | "poor">> => {
    const result: Record<number, "good" | "ok" | "poor"> = {};
    const userIds = new Set<number>([
      ...Object.keys(screenPCsRef.current).map(Number),
      ...Object.keys(audioPCsRef.current).map(Number),
    ]);
    await Promise.all(Array.from(userIds).map(async (userId) => {
      const pc = screenPCsRef.current[userId] ?? audioPCsRef.current[userId];
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        let rtt = 0;
        let lossRatio = 0;
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && (report as any).nominated && (report as any).currentRoundTripTime != null) {
            rtt = (report as any).currentRoundTripTime;
          }
          if (report.type === "remote-inbound-rtp" && (report as any).fractionLost != null) {
            lossRatio = Math.max(lossRatio, (report as any).fractionLost);
          }
        });
        let quality: "good" | "ok" | "poor" = "good";
        if (rtt > 0.3 || lossRatio > 0.1) quality = "poor";
        else if (rtt > 0.15 || lossRatio > 0.03) quality = "ok";
        result[userId] = quality;
      } catch {
        result[userId] = "ok";
      }
    }));
    return result;
  }, []);

  const cleanup = useCallback(() => {
    Object.values(screenPCsRef.current).forEach(pc => pc.close());
    screenPCsRef.current = {};
    Object.values(audioPCsRef.current).forEach(pc => pc.close());
    audioPCsRef.current = {};
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    teardownMic();
    setLocalStream(null);
    setIsSharing(false);
    setIsInVoice(false);
    setRemoteStreams({});
    setRemoteAudioStreams({});
  }, [teardownMic]);

  return {
    localStream, remoteStreams, remoteAudioStreams,
    isSharing, isInVoice,
    startSharing, stopSharing,
    handleOffer, handleAnswer, handleIceCandidate, sendOffer,
    joinVoice, leaveVoice,
    sendAudioOffer, handleAudioOffer, handleAudioAnswer, handleAudioIce,
    setMicEnabled, getConnectionStats,
    cleanup,
  };
}
