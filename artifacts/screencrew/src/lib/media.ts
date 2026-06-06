import type { AppSettings, VideoQuality, VideoCodec } from "@/lib/settings";

// ─── Video quality presets ───────────────────────────────────────────────────

export const VIDEO_QUALITY_PRESETS: Record<
  Exclude<VideoQuality, "auto">,
  { width: number; height: number; frameRate: number }
> = {
  "1080p60": { width: 1920, height: 1080, frameRate: 60 },
  "1080p30": { width: 1920, height: 1080, frameRate: 30 },
  "720p30":  { width: 1280, height: 720,  frameRate: 30 },
  "480p30":  { width: 854,  height: 480,  frameRate: 30 },
};

export const VIDEO_QUALITY_LABELS: Record<VideoQuality, string> = {
  auto: "Auto",
  "1080p60": "1080p60",
  "1080p30": "1080p30",
  "720p30": "720p",
  "480p30": "480p",
};

export const VIDEO_BITRATE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Auto" },
  { value: 2000, label: "2 Mbps" },
  { value: 5000, label: "5 Mbps" },
  { value: 10000, label: "10 Mbps" },
  { value: 20000, label: "20 Mbps" },
];

// ─── Constraint builders ─────────────────────────────────────────────────────

type AudioCaptureSettings = Pick<
  AppSettings,
  "micDeviceId" | "echoCancellation" | "noiseSuppression" | "autoGainControl"
>;

export function buildAudioConstraints(s: AudioCaptureSettings): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: s.autoGainControl,
  };
  if (s.micDeviceId) c.deviceId = { exact: s.micDeviceId };
  return c;
}

type VideoCaptureSettings = Pick<AppSettings, "videoQuality" | "shareSystemAudio">;

export function buildDisplayConstraints(s: VideoCaptureSettings): MediaStreamConstraints {
  let video: MediaTrackConstraints | boolean = true;
  if (s.videoQuality !== "auto") {
    const p = VIDEO_QUALITY_PRESETS[s.videoQuality];
    video = {
      width: { ideal: p.width },
      height: { ideal: p.height },
      frameRate: { ideal: p.frameRate, max: p.frameRate },
    };
  }
  return { video, audio: s.shareSystemAudio };
}

// ─── WebRTC codec / bitrate preferences ──────────────────────────────────────

const CODEC_MIME: Record<Exclude<VideoCodec, "auto">, string> = {
  VP9: "video/vp9",
  VP8: "video/vp8",
  H264: "video/h264",
  AV1: "video/av1",
};

export function applyCodecPreference(pc: RTCPeerConnection, codec: VideoCodec) {
  if (codec === "auto") return;
  if (typeof RTCRtpSender === "undefined" || typeof RTCRtpSender.getCapabilities !== "function") return;
  const caps = RTCRtpSender.getCapabilities("video");
  if (!caps) return;
  const want = CODEC_MIME[codec];
  const preferred = caps.codecs.filter((c) => c.mimeType.toLowerCase() === want);
  if (preferred.length === 0) return;
  const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== want);
  const ordered = [...preferred, ...rest];
  for (const t of pc.getTransceivers()) {
    if (t.sender?.track?.kind === "video" && typeof t.setCodecPreferences === "function") {
      try { t.setCodecPreferences(ordered); } catch { /* unsupported ordering — fall back to default */ }
    }
  }
}

export async function applyVideoBitrate(pc: RTCPeerConnection, kbps: number) {
  if (!kbps) return;
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind === "video") {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = kbps * 1000;
      try { await sender.setParameters(params); } catch { /* ignore unsupported */ }
    }
  }
}
