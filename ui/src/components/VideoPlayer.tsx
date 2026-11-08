import React, { useRef, useEffect, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize2, SkipBack, SkipForward, FastForward } from "lucide-react";

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
    <div className="relative w-full h-full bg-black rounded border border-zinc-850 overflow-hidden flex flex-col items-center justify-center select-none group">
      {/* Video Viewport */}
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

      {/* Embedded Studio Transport Bar (Compact 32px) */}
      <div className="absolute bottom-0 left-0 right-0 h-8 px-3 bg-zinc-950/90 border-t border-zinc-850 flex items-center justify-between font-mono text-xs opacity-95 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-1">
          {/* Step Back 1 Frame */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTimeUpdate(Math.max(0, currentTime - 0.04));
            }}
            aria-label="Step back 1 frame (Left Arrow)" title="Step Back 1 Frame (Left Arrow)"
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 transition cursor-pointer"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            aria-label={isPlaying ? "Pause (Space or K)" : "Play (Space or K)"} title={isPlaying ? "Pause (Space or K)" : "Play (Space or K)"}
            className="p-1 rounded text-zinc-200 hover:text-cyan-400 hover:bg-zinc-850 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 transition cursor-pointer"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          {/* Step Forward 1 Frame */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTimeUpdate(Math.min(duration, currentTime + 0.04));
            }}
            aria-label="Step forward 1 frame (Right Arrow)" title="Step Forward 1 Frame (Right Arrow)"
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 transition cursor-pointer"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <div className="h-3 w-px bg-zinc-800 mx-1.5" />

          {/* Timecode readout */}
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-zinc-100 font-semibold tracking-wider">
              {formatSMPTETimecode(currentTime)}
            </span>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-500">{formatSMPTETimecode(duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Live Skip-Silence Audition Toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSkipSilencePreview();
            }}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition cursor-pointer ${
              skipSilencePreview
                ? "bg-emerald-950/40 border-emerald-700 text-emerald-400"
                : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
            }`}
            aria-pressed={skipSilencePreview} title="Live Audition: Automatically skip silent intervals during playback (S)"
          >
            <FastForward className="w-3 h-3" />
            <span>{skipSilencePreview ? "LIVE SKIP: ON" : "LIVE SKIP: OFF"}</span>
          </button>

          {/* Playback Speed Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCyclePlaybackRate();
            }}
            className={`px-1.5 py-0.5 rounded text-[10px] border transition cursor-pointer ${
              playbackRate !== 1
                ? "bg-cyan-950/40 border-cyan-700 text-cyan-300 font-bold"
                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
            title="Cycle Playback Speed 1x / 1.5x / 2x / 4x (L)"
          >
            {playbackRate.toFixed(1)}x
          </button>

          {/* Mute button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsMuted(!isMuted);
            }}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 transition cursor-pointer"
            aria-label={isMuted ? "Unmute audio" : "Mute audio"} aria-pressed={isMuted} title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 text-zinc-500" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          {/* Fullscreen */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (videoRef.current?.requestFullscreen) {
                videoRef.current.requestFullscreen();
              }
            }}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 transition cursor-pointer"
            aria-label="Toggle fullscreen" title="Fullscreen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
