import { useState, useCallback, useRef, useEffect } from "react";

export function useWebRTC(
  wsSend: (message: any) => void,
  onStreamStart?: () => void,
  onStreamStop?: () => void
) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<number, MediaStream>>({});
  const peerConnections = useRef<Record<number, RTCPeerConnection>>({});
  const [isSharing, setIsSharing] = useState(false);

  const cleanup = useCallback(() => {
    Object.values(peerConnections.current).forEach(pc => pc.close());
    peerConnections.current = {};
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      setLocalStream(null);
    }
    setIsSharing(false);
    setRemoteStreams({});
  }, [localStream]);

  const startSharing = useCallback(async (roomId: number) => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      setLocalStream(stream);
      setIsSharing(true);
      onStreamStart?.();

      stream.getVideoTracks()[0].onended = () => {
        stopSharing();
      };
      
      // Need to notify room that we are streaming. The backend handles presence update.
      // And we wait for others to request stream or we broadcast offer to everyone?
      // "When receiving an offer: create RTCPeerConnection..."
      // But the prompt says: "create offer, set localDescription, send offer via WebSocket to all room members"
      // Wait, we need to know who is in the room to send offers to them? 
      // The prompt says: `{ type: "stream_offer", to: userId, sdp: string }`
      // We'll expose `createOffer` for a specific user.
    } catch (e) {
      console.error("Failed to start screen share", e);
    }
  }, [onStreamStart]);

  const stopSharing = useCallback(() => {
    cleanup();
    onStreamStop?.();
  }, [cleanup, onStreamStop]);

  const getPeerConnection = useCallback((userId: number) => {
    if (!peerConnections.current[userId]) {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          wsSend({ type: "ice_candidate", to: userId, candidate: e.candidate });
        }
      };

      pc.ontrack = (e) => {
        setRemoteStreams(prev => ({ ...prev, [userId]: e.streams[0] }));
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
          setRemoteStreams(prev => {
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        }
      };

      if (localStream) {
        localStream.getTracks().forEach(track => {
          pc.addTrack(track, localStream);
        });
      }

      peerConnections.current[userId] = pc;
    }
    return peerConnections.current[userId];
  }, [localStream, wsSend]);

  const handleOffer = useCallback(async (from: number, sdp: string) => {
    const pc = getPeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsSend({ type: "stream_answer", to: from, sdp: answer.sdp });
  }, [getPeerConnection, wsSend]);

  const handleAnswer = useCallback(async (from: number, sdp: string) => {
    const pc = getPeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }));
  }, [getPeerConnection]);

  const handleIceCandidate = useCallback(async (from: number, candidate: RTCIceCandidateInit) => {
    const pc = getPeerConnection(from);
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }, [getPeerConnection]);

  const sendOffer = useCallback(async (to: number) => {
    const pc = getPeerConnection(to);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsSend({ type: "stream_offer", to, sdp: offer.sdp });
  }, [getPeerConnection, wsSend]);

  return {
    localStream,
    remoteStreams,
    isSharing,
    startSharing,
    stopSharing,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    sendOffer,
    cleanup
  };
}
