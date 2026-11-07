import React, { useRef, useEffect, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize2, SkipBack, SkipForward } from "lucide-react";

interface VideoPlayerProps {
  src: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onTimeUpdate: (time: number) => void;
  onTogglePlay: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  isPlaying,
  currentTime,
  duration,
  onTimeUpdate,
  onTogglePlay,
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
    if (videoRef.current && isPlaying) {
      onTimeUpdate(videoRef.current.currentTime);
    }
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
        muted={isMuted}
        playsInline
      />

      {/* Embedded Studio Transport Bar (Compact 32px) */}
      <div className="absolute bottom-0 left-0 right-0 h-8 px-3 bg-zinc-950/90 border-t border-zinc-850 flex items-center justify-between font-mono text-xs opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-1">
          {/* Step Back 1 Frame */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTimeUpdate(Math.max(0, currentTime - 0.04));
            }}
            title="Step Back 1 Frame (Left Arrow)"
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850 transition"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            title="Play / Pause (Space)"
            className="p-1 rounded text-zinc-200 hover:text-cyan-400 hover:bg-zinc-850 transition"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          {/* Step Forward 1 Frame */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTimeUpdate(Math.min(duration, currentTime + 0.04));
            }}
            title="Step Forward 1 Frame (Right Arrow)"
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-850 transition"
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
          {/* Mute button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsMuted(!isMuted);
            }}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850 transition"
            title={isMuted ? "Unmute" : "Mute"}
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
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850 transition"
            title="Fullscreen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
