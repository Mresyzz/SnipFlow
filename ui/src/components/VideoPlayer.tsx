import React, { useRef, useEffect } from "react";
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
  const [isMuted, setIsMuted] = React.useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying && video.paused) {
      video.play().catch(() => {});
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isPlaying]);

  // Synchronize external seek into video element with sub-frame precision
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const diff = Math.abs(video.currentTime - currentTime);
    // When paused, frame-accurate seeking (threshold: 0.005s = 5ms)
    // When playing, allow video to clock naturally unless large seek jump occurs
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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  return (
    <div className="relative w-full h-full bg-black/95 rounded-xl overflow-hidden flex flex-col items-center justify-center border border-dark-800 shadow-2xl group">
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain cursor-pointer"
        onClick={onTogglePlay}
        onTimeUpdate={handleTimeUpdate}
        muted={isMuted}
        playsInline
      />

      {/* Floating Transport Bar */}
      <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between px-4 py-2 bg-dark-900/85 backdrop-blur-md rounded-lg border border-dark-800/80 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <div className="flex items-center gap-2">
          {/* Step Backward 1 Frame */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTimeUpdate(Math.max(0, currentTime - 0.04));
            }}
            title="Step Back 1 Frame (Left Arrow)"
            className="p-1.5 rounded-md hover:bg-dark-800 text-neutral-400 hover:text-neutral-200 transition"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            title="Toggle Play (Space)"
            className="p-1.5 rounded-md hover:bg-dark-800 text-neutral-200 hover:text-cyan-400 transition"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          {/* Step Forward 1 Frame */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTimeUpdate(Math.min(duration, currentTime + 0.04));
            }}
            title="Step Forward 1 Frame (Right Arrow)"
            className="p-1.5 rounded-md hover:bg-dark-800 text-neutral-400 hover:text-neutral-200 transition"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          {/* Audio Mute */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsMuted(!isMuted);
            }}
            className="p-1.5 rounded-md hover:bg-dark-800 text-neutral-400 hover:text-neutral-200 transition"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <span className="text-xs font-mono text-neutral-400 ml-2">
            <strong className="text-neutral-200">{formatTime(currentTime)}</strong> /{" "}
            {formatTime(duration)}
          </span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            if (videoRef.current?.requestFullscreen) {
              videoRef.current.requestFullscreen();
            }
          }}
          className="p-1.5 rounded-md hover:bg-dark-800 text-neutral-400 hover:text-neutral-200 transition"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
