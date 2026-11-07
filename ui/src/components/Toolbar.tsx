import React from "react";
import {
  Magnet,
  Scissors,
  Download,
  Clock,
  ZoomIn,
  ZoomOut,
  Disc,
  Layers,
  Sparkles,
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

  const isKeyframeAligned =
    inPoint !== null &&
    keyframes.length > 0 &&
    keyframes.some((kf) => Math.abs(kf - inPoint) < 0.05);

  const formatSec = (s: number | null) => (s !== null ? `${s.toFixed(2)}s` : "--");

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded font-mono text-xs select-none">
      {/* Left: Trim Markers & Snapping & Keyframe Status */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onToggleMagneticSnap}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition cursor-pointer ${
            isMagneticSnapEnabled
              ? "bg-zinc-800 border-zinc-650 text-cyan-400"
              : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
          }`}
          title="Toggle Keyframe Magnetic Snap"
        >
          <Magnet className="w-3 h-3" />
          <span>SNAP</span>
        </button>

        <div className="h-3.5 w-px bg-zinc-800 mx-0.5" />

        <button
          onClick={onMarkIn}
          className="px-2 py-1 rounded bg-zinc-850 hover:bg-zinc-800 text-zinc-200 border border-zinc-750 text-[11px] transition cursor-pointer"
          title="Set In-Point (I)"
        >
          IN: {formatSec(inPoint)}
        </button>
        <button
          onClick={onMarkOut}
          className="px-2 py-1 rounded bg-zinc-850 hover:bg-zinc-800 text-zinc-200 border border-zinc-750 text-[11px] transition cursor-pointer"
          title="Set Out-Point (O)"
        >
          OUT: {formatSec(outPoint)}
        </button>

        <span className="text-[10px] text-zinc-500 font-mono ml-1">
          POS: {currentTime.toFixed(2)}s
        </span>

        {selectionDuration !== null && (
          <span className="text-[11px] text-zinc-400 font-semibold px-1">
            [{selectionDuration.toFixed(2)}s]
          </span>
        )}

        {/* I-Frame Alignment Status LED */}
        {inPoint !== null && keyframes.length > 0 && (
          <button
            onClick={onSnapInToKeyframe}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition cursor-pointer ${
              isKeyframeAligned
                ? "bg-emerald-950/20 border-emerald-800 text-emerald-400"
                : "bg-amber-950/20 border-amber-800 text-amber-400 hover:bg-amber-900/30"
            }`}
            title={
              isKeyframeAligned
                ? "Lossless boundary aligned to I-frame"
                : "Unaligned boundary. Click to snap to nearest I-frame"
            }
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isKeyframeAligned ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
            <span>{isKeyframeAligned ? "I-FRAME" : "SNAP I-FRAME"}</span>
          </button>
        )}

        {/* Timeline Zoom */}
        <div className="flex items-center bg-zinc-950 px-1 py-0.5 rounded border border-zinc-800 ml-1">
          <button
            onClick={onZoomOut}
            disabled={zoomLevel <= 1}
            className="p-0.5 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-[10px] text-zinc-500 px-1">{zoomLevel}x</span>
          <button
            onClick={onZoomIn}
            disabled={zoomLevel >= 8}
            className="p-0.5 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Middle: Audio Track & Silence Threshold */}
      <div className="flex items-center gap-2">
        {highlightCount > 0 && (
          <button
            onClick={onNextHighlight}
            className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-850 hover:bg-zinc-800 text-amber-400 border border-zinc-750 text-[11px] cursor-pointer"
            title="Jump to Next Peak (H)"
          >
            <Sparkles className="w-3 h-3" />
            <span>PEAK ({highlightCount})</span>
          </button>
        )}

        {audioTracks.length > 1 && (
          <div className="flex items-center gap-1 bg-zinc-850 px-1.5 py-0.5 rounded border border-zinc-750 text-[11px] text-zinc-300">
            <Disc className="w-3 h-3 text-zinc-500" />
            <select
              value={selectedTrackIndex}
              onChange={(e) => onSelectTrack(Number(e.target.value))}
              className="bg-transparent text-zinc-200 text-[11px] focus:outline-none cursor-pointer"
            >
              {audioTracks.map((t) => (
                <option key={t.track_index} value={t.track_index} className="bg-zinc-900">
                  {t.title ? `${t.title}` : `A${t.track_index + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <span className="text-zinc-500">THRESH</span>
          <span className="text-zinc-300 w-11 text-right">{noiseDb}dB</span>
          <input
            type="range"
            min="-50"
            max="-15"
            step="1"
            value={noiseDb}
            onChange={(e) => onNoiseDbChange(Number(e.target.value))}
            className="w-16 h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-zinc-400"
          />
        </div>

        <button
          onClick={onStripSilence}
          className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-850 hover:bg-zinc-800 text-rose-400 border border-zinc-750 text-[11px] cursor-pointer"
          title="Select first voice segment"
        >
          <Scissors className="w-3 h-3" />
          <span>PURGE SILENCE ({silenceCount})</span>
        </button>
      </div>

      {/* Right: Export Actions */}
      <div className="flex items-center gap-1.5">
        {lastExportElapsedMs !== null && (
          <span className="text-[10px] text-emerald-400 mr-1">
            {lastExportElapsedMs.toFixed(1)}ms
          </span>
        )}

        {activeSegmentCount > 1 && (
          <button
            onClick={onBatchExport}
            disabled={isExporting}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border border-zinc-750 text-[11px] cursor-pointer disabled:opacity-40"
            title="Batch Export All Clean Clips"
          >
            <Layers className="w-3 h-3" />
            <span>BATCH ({activeSegmentCount})</span>
          </button>
        )}

        <button
          onClick={onExport}
          disabled={isExporting}
          className="flex items-center gap-1.5 px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-zinc-950 font-bold text-[11px] transition cursor-pointer disabled:opacity-40"
          title="Lossless Export (Enter)"
        >
          {isExporting ? (
            <>
              <Clock className="w-3 h-3 animate-spin" />
              <span>EXPORTING...</span>
            </>
          ) : (
            <>
              <Download className="w-3 h-3" />
              <span>CUT EXPORT</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
