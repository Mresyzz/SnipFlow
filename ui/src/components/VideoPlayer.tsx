import React, { useRef, useEffect, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize2, SkipBack, SkipForward, FastForward, Camera } from "lucide-react";

interface VideoPlayerProps {
  src: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  skipSilencePreview: boolean;
  silenceIntervals: [number, number][];
  onTimeUpdate: (time: number) => void;
  onTogglePlay: () => void;
  onEnded: () => void;
  onCyclePlaybackRate: () => void;
  onToggleSkipSilencePreview: () => void;
  onSnapshot?: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  skipSilencePreview,
  silenceIntervals,
  onTimeUpdate,
  onTogglePlay,
  onEnded,
  onCyclePlaybackRate,
  onToggleSkipSilencePreview,
  onSnapshot,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying && video.paused) {
      video.play().catch(() => {});
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate]);

  // Synchronize external seek with sub-frame precision
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const diff = Math.abs(video.currentTime - currentTime);
    const threshold = isPlaying ? 0.25 : 0.005;

    if (diff > threshold) {
      video.currentTime = currentTime;
    }
  }, [currentTime, isPlaying]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !isPlaying) return;

    const t = video.currentTime;

    // Live Skip-Silence Audition: jump across silent dead-air in real time during playback
    if (skipSilencePreview && silenceIntervals.length > 0) {
      for (const [s, e] of silenceIntervals) {
        const paddedStart = s + 0.05;
        const paddedEnd = e - 0.05;
        if (paddedEnd > paddedStart && t >= paddedStart && t < paddedEnd) {
          video.currentTime = paddedEnd;
          onTimeUpdate(paddedEnd);
          return;
        }
      }
    }

    onTimeUpdate(t);
  };

  const formatSMPTETimecode = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
  };

  return (
    <div className="relative w-full h-full bg-[#070709] rounded-xl border border-white/[0.06] overflow-hidden flex flex-col select-none group">
      {/* Video Viewport */}
      <div className="flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full object-contain cursor-pointer"
          onClick={onTogglePlay}
          onTimeUpdate={handleTimeUpdate}
          onEnded={onEnded}
          muted={isMuted}
          playsInline
        />
      </div>

      {/* Monochrome Studio Transport Bar */}
      <div className="h-11 px-4 bg-[#111115]/95 border-t border-white/[0.06] flex items-center justify-between text-xs shrink-0">
        {/* Left: SMPTE Timecode */}
        <div className="flex items-center gap-2 font-mono tabular-nums text-xs min-w-[200px]">
          <span className="text-zinc-100 font-medium">
            {formatSMPTETimecode(currentTime)}
          </span>
          <span className="text-zinc-600">/</span>
          <span className="text-zinc-500">{formatSMPTETimecode(duration)}</span>
        </div>

        {/* Center: Frame-Step & Play/Pause Controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTimeUpdate(Math.max(0, currentTime - 0.04));
            }}
            aria-label="Step back 1 frame (Left Arrow)"
            title="Step Back 1 Frame (Left Arrow)"
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            aria-label={isPlaying ? "Pause (Space or K)" : "Play (Space or K)"}
            title={isPlaying ? "Pause (Space or K)" : "Play (Space or K)"}
            className="w-8 h-8 rounded-full bg-white hover:bg-zinc-200 text-black flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition cursor-pointer shadow-sm"
          >
            {isPlaying ? (
              <Pause className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onTimeUpdate(Math.min(duration, currentTime + 0.04));
            }}
            aria-label="Step forward 1 frame (Right Arrow)"
            title="Step Forward 1 Frame (Right Arrow)"
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Live Skip-Silence Audition, Speed, Mute & Fullscreen */}
        <div className="flex items-center justify-end gap-2 min-w-[200px] shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSkipSilencePreview();
            }}
            aria-pressed={skipSilencePreview}
            title="Live Audition: Automatically skip silent intervals during playback (S)"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer ${
              skipSilencePreview
                ? "bg-white border-white text-black"
                : "bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <FastForward className="w-3 h-3" />
            <span>Skip Silence</span>
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onCyclePlaybackRate();
            }}
            aria-label="Playback speed"
            title="Cycle Playback Speed 1x / 1.5x / 2x / 4x (L)"
            className={`px-2 py-1 rounded-md font-mono text-[11px] tabular-nums border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer ${
              playbackRate !== 1
                ? "bg-white border-white text-black font-semibold"
                : "bg-white/[0.03] hover:bg-white/[0.07] border-white/[0.08] text-zinc-300"
            }`}
          >
            {playbackRate.toFixed(1)}x
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsMuted(!isMuted);
            }}
            aria-label={isMuted ? "Unmute audio" : "Mute audio"}
            aria-pressed={isMuted}
            title={isMuted ? "Unmute" : "Mute"}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer"
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-zinc-500" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>

          {onSnapshot && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSnapshot();
              }}
              aria-label="Capture full-resolution frame snapshot (P)"
              title="Capture full-resolution frame snapshot (P)"
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              if (videoRef.current?.requestFullscreen) {
                videoRef.current.requestFullscreen();
              }
            }}
            aria-label="Toggle fullscreen"
            title="Fullscreen"
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
