import React from "react";
import {
  Magnet,
  Scissors,
  MicOff,
  Download,
  CheckCircle,
  Clock,
  ZoomIn,
  ZoomOut,
  Disc,
  Sparkles,
  Layers,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { AudioStreamInfo } from "../types";

interface ToolbarProps {
  inPoint: number | null;
  outPoint: number | null;
  currentTime: number;
  keyframes: number[];
  isMagneticSnapEnabled: boolean;
  noiseDb: number;
  zoomLevel: number;
  isExporting: boolean;
  lastExportElapsedMs: number | null;
  silenceCount: number;
  audioTracks: AudioStreamInfo[];
  selectedTrackIndex: number;
  highlightCount: number;
  activeSegmentCount: number;
  onSelectTrack: (trackIndex: number) => void;
  onToggleMagneticSnap: () => void;
  onNoiseDbChange: (db: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onSnapInToKeyframe: () => void;
  onStripSilence: () => void;
  onNextHighlight: () => void;
  onExport: () => void;
  onBatchExport: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  inPoint,
  outPoint,
  currentTime,
  keyframes,
  isMagneticSnapEnabled,
  noiseDb,
  zoomLevel,
  isExporting,
  lastExportElapsedMs,
  silenceCount,
  audioTracks,
  selectedTrackIndex,
  highlightCount,
  activeSegmentCount,
  onSelectTrack,
  onToggleMagneticSnap,
  onNoiseDbChange,
  onZoomIn,
  onZoomOut,
  onMarkIn,
  onMarkOut,
  onSnapInToKeyframe,
  onStripSilence,
  onNextHighlight,
  onExport,
  onBatchExport,
}) => {
  const selectionDuration =
    inPoint !== null && outPoint !== null ? Math.max(0, outPoint - inPoint) : null;

  // Check if In-point matches an exact I-frame boundary (< 50ms)
  const isKeyframeAligned =
    inPoint !== null &&
    keyframes.length > 0 &&
    keyframes.some((kf) => Math.abs(kf - inPoint) < 0.05);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-dark-900 border border-dark-800 rounded-xl shadow-lg">
      {/* Left section: In/Out points & Snapping & Zoom */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={onToggleMagneticSnap}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
            isMagneticSnapEnabled
              ? "bg-cyan-400/10 border-cyan-400/40 text-cyan-400 shadow-sm"
              : "bg-dark-850 border-dark-750 text-neutral-400 hover:text-neutral-200"
          }`}
          title="Toggle Magnetic Snap to Keyframes"
        >
          <Magnet className="w-3.5 h-3.5" />
          <span>I-Frame Snap</span>
        </button>

        <div className="h-4 w-px bg-dark-800" />

        <div className="flex items-center gap-1.5">
          <button
            onClick={onMarkIn}
            className="px-2.5 py-1 rounded bg-dark-850 hover:bg-dark-800 border border-dark-700 text-xs font-mono text-neutral-300 hover:text-cyan-400 transition cursor-pointer"
            title="Mark In Point [I]"
          >
            [ In: {inPoint !== null ? inPoint.toFixed(2) + "s" : "--"}
          </button>
          <button
            onClick={onMarkOut}
            className="px-2.5 py-1 rounded bg-dark-850 hover:bg-dark-800 border border-dark-700 text-xs font-mono text-neutral-300 hover:text-cyan-400 transition cursor-pointer"
            title="Mark Out Point [O]"
          >
            Out: {outPoint !== null ? outPoint.toFixed(2) + "s" : "--"} ]
          </button>

          {selectionDuration !== null && (
            <span className="text-xs font-mono text-cyan-400 ml-1">
              ({selectionDuration.toFixed(2)}s)
            </span>
          )}

          {/* Keyframe GOP Alignment Badge */}
          {inPoint !== null && keyframes.length > 0 && (
            <button
              onClick={onSnapInToKeyframe}
              title={
                isKeyframeAligned
                  ? "Perfect I-Frame Cut: Zero freeze frames on playback"
                  : "Unaligned GOP: Click to snap In-point to nearest Keyframe for 100% clean lossless cut"
              }
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono border transition cursor-pointer ${
                isKeyframeAligned
                  ? "bg-green-500/10 border-green-500/30 text-green-400"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
              }`}
            >
              {isKeyframeAligned ? (
                <>
                  <ShieldCheck className="w-3 h-3 text-green-400" />
                  <span>I-Frame Aligned</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-3 h-3 text-amber-400" />
                  <span>Snap to I-Frame</span>
                </>
              )}
            </button>
          )}

          <span className="text-[11px] font-mono text-neutral-500 ml-1">
            Pos: {currentTime.toFixed(2)}s
          </span>
        </div>

        {/* Timeline Zoom Controls */}
        <div className="flex items-center gap-1 ml-1 bg-dark-850 px-1.5 py-0.5 rounded border border-dark-750">
          <button
            onClick={onZoomOut}
            disabled={zoomLevel <= 1}
            className="p-1 hover:text-cyan-400 disabled:opacity-30 text-neutral-400 transition cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono text-neutral-400 px-1">{zoomLevel}x</span>
          <button
            onClick={onZoomIn}
            disabled={zoomLevel >= 8}
            className="p-1 hover:text-cyan-400 disabled:opacity-30 text-neutral-400 transition cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Middle section: Highlights, Tracks, Silence Stripper */}
      <div className="flex items-center gap-2.5">
        {highlightCount > 0 && (
          <button
            onClick={onNextHighlight}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-xs font-medium text-amber-400 transition cursor-pointer"
            title="Jump to Next Peak Highlight [H]"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Peak ({highlightCount})</span>
          </button>
        )}

        {audioTracks.length > 1 && (
          <div className="flex items-center gap-1.5 bg-dark-850 px-2 py-1 rounded-lg border border-dark-750 text-xs text-neutral-300">
            <Disc className="w-3.5 h-3.5 text-cyan-400" />
            <select
              value={selectedTrackIndex}
              onChange={(e) => onSelectTrack(Number(e.target.value))}
              className="bg-transparent text-cyan-400 font-mono text-xs focus:outline-none cursor-pointer"
            >
              {audioTracks.map((t) => (
                <option key={t.track_index} value={t.track_index} className="bg-dark-900 text-neutral-200">
                  {t.title ? `${t.title}` : `Track ${t.track_index + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <MicOff className="w-3.5 h-3.5 text-danger-500" />
          <span className="font-mono text-neutral-200">{noiseDb} dB</span>
          <input
            type="range"
            min="-50"
            max="-15"
            step="1"
            value={noiseDb}
            onChange={(e) => onNoiseDbChange(Number(e.target.value))}
            className="w-20 h-1.5 bg-dark-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>

        <button
          onClick={onStripSilence}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-danger-500/10 hover:bg-danger-500/20 border border-danger-500/30 text-xs font-medium text-danger-500 transition cursor-pointer"
          title="Auto-select first active speech segment"
        >
          <Scissors className="w-3.5 h-3.5" />
          <span>Purge Silence ({silenceCount})</span>
        </button>
      </div>

      {/* Right section: Single Export & Batch Export */}
      <div className="flex items-center gap-2.5">
        {lastExportElapsedMs !== null && (
          <div className="flex items-center gap-1.5 text-xs text-green-400 font-mono">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>{lastExportElapsedMs.toFixed(1)}ms</span>
          </div>
        )}

        {activeSegmentCount > 1 && (
          <button
            onClick={onBatchExport}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-850 hover:bg-dark-800 border border-dark-700 text-xs font-medium text-neutral-200 hover:text-cyan-400 transition cursor-pointer disabled:opacity-50"
            title="Batch Export All Clean Clips"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Batch All ({activeSegmentCount})</span>
          </button>
        )}

        <button
          onClick={onExport}
          disabled={isExporting}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-dark-950 font-semibold text-xs transition shadow-md shadow-cyan-500/20 disabled:opacity-50 cursor-pointer"
          title="Instant Lossless Cut [Enter]"
        >
          {isExporting ? (
            <>
              <Clock className="w-3.5 h-3.5 animate-spin" />
              <span>Copying...</span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" />
              <span>Lossless Export</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
