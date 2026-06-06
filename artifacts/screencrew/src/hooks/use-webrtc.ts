import { useState, useCallback, useRef, useEffect } from "react";

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
  const micStreamRef = useRef<MediaStream | null>(null);
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
      }
      screenPCsRef.current[userId] = pc;
    }
    return screenPCsRef.current[userId];
  }, [localStream]);

  const startSharing = useCallback(async (_roomId: number) => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
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
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); setLocalStream(null); }
    setIsSharing(false);
    setRemoteStreams({});
    onStreamStop?.();
  }, [localStream, onStreamStop]);

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
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
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

  const joinVoice = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;
      setIsInVoice(true);
      return stream;
    } catch {
      return null;
    }
  }, []);

  const leaveVoice = useCallback(() => {
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    Object.values(audioPCsRef.current).forEach(pc => pc.close());
    audioPCsRef.current = {};
    setRemoteAudioStreams({});
    setIsInVoice(false);
  }, []);

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

  const cleanup = useCallback(() => {
    Object.values(screenPCsRef.current).forEach(pc => pc.close());
    screenPCsRef.current = {};
    Object.values(audioPCsRef.current).forEach(pc => pc.close());
    audioPCsRef.current = {};
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    setLocalStream(null);
    setIsSharing(false);
    setIsInVoice(false);
    setRemoteStreams({});
    setRemoteAudioStreams({});
  }, [localStream]);

  return {
    localStream, remoteStreams, remoteAudioStreams,
    isSharing, isInVoice,
    startSharing, stopSharing,
    handleOffer, handleAnswer, handleIceCandidate, sendOffer,
    joinVoice, leaveVoice,
    sendAudioOffer, handleAudioOffer, handleAudioAnswer, handleAudioIce,
    cleanup,
  };
}
