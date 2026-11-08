import React from "react";
import {
  Magnet,
  Scissors,
  ZoomIn,
  ZoomOut,
  Disc,
  Sparkles,
  Activity,
  Flame,
  Sliders,
} from "lucide-react";
import { AudioStreamInfo } from "../types";

interface ToolbarProps {
  inPoint: number | null;
  outPoint: number | null;
  currentTime: number;
  keyframes: number[];
  isMagneticSnapEnabled: boolean;
  noiseDb: number;
  minSilenceDuration: number;
  zoomLevel: number;
  isCalibrating: boolean;
  silenceCount: number;
  audioTracks: AudioStreamInfo[];
  selectedTrackIndex: number;
  highlightCount: number;
  totalKeptSec: number;
  savedSec: number;
  onAutoCalibrateNoiseFloor: () => void;
  onSelectTrack: (trackIndex: number) => void;
  onToggleMagneticSnap: () => void;
  onNoiseDbChange: (db: number) => void;
  onMinSilenceDurationChange: (minDur: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onSliceAtPlayhead: () => void;
  onSnapInToKeyframe: () => void;
  onStripSilence: () => void;
  onNextHighlight: () => void;
  onBuildHighlightReel: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  inPoint,
  outPoint,
  keyframes,
  isMagneticSnapEnabled,
  noiseDb,
  minSilenceDuration,
  zoomLevel,
  isCalibrating,
  silenceCount,
  audioTracks,
  selectedTrackIndex,
  highlightCount,
  totalKeptSec,
  savedSec,
  onAutoCalibrateNoiseFloor,
  onSelectTrack,
  onToggleMagneticSnap,
  onNoiseDbChange,
  onMinSilenceDurationChange,
  onZoomIn,
  onZoomOut,
  onMarkIn,
  onMarkOut,
  onSliceAtPlayhead,
  onSnapInToKeyframe,
  onStripSilence,
  onNextHighlight,
  onBuildHighlightReel,
}) => {
  const selectionDuration =
    inPoint !== null && outPoint !== null ? Math.max(0, outPoint - inPoint) : null;

  // Calculate millisecond drift relative to nearest keyframe for In-point
  let nearestKf: number | null = null;
  let driftMs: number | null = null;
  let isKeyframeAligned = false;

  if (inPoint !== null && keyframes.length > 0) {
    let minDiff = Infinity;
    for (const kf of keyframes) {
      const diff = Math.abs(kf - inPoint);
      if (diff < minDiff) {
        minDiff = diff;
        nearestKf = kf;
      }
    }
    if (nearestKf !== null) {
      driftMs = (inPoint - nearestKf) * 1000.0;
      isKeyframeAligned = Math.abs(driftMs) < 18.0;
    }
  }

  const formatSec = (s: number | null) => (s !== null ? `${s.toFixed(2)}s` : "--");

  return (
    <div className="min-h-10 px-3.5 py-1.5 bg-[#111115] border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-xs select-none">
      {/* Left: Split, Snap, In/Out Trim Markers & I-Frame Alignment */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onSliceAtPlayhead}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer"
          title="Split active clip at playhead (X)"
        >
          <Scissors className="w-3.5 h-3.5 text-zinc-400" />
          <span>Split</span>
        </button>

        <button
          onClick={onToggleMagneticSnap}
          aria-pressed={isMagneticSnapEnabled}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer ${
            isMagneticSnapEnabled
              ? "bg-white text-black border-white font-medium"
              : "bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-zinc-200"
          }`}
          title="Toggle Keyframe Magnetic Snap"
        >
          <Magnet className="w-3.5 h-3.5" />
          <span>Snap</span>
        </button>

        <div className="h-3.5 w-px bg-white/[0.08] mx-0.5" />

        <button
          onClick={onMarkIn}
          className="px-2 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 border border-white/[0.08] font-mono text-[11px] tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer"
          title="Set In-Point at Playhead (I)"
        >
          IN {formatSec(inPoint)}
        </button>
        <button
          onClick={onMarkOut}
          className="px-2 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 border border-white/[0.08] font-mono text-[11px] tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer"
          title="Set Out-Point at Playhead (O)"
        >
          OUT {formatSec(outPoint)}
        </button>

        {selectionDuration !== null && (
          <span className="text-[11px] text-zinc-400 font-mono tabular-nums px-1">
            [{selectionDuration.toFixed(2)}s]
          </span>
        )}

        {/* I-Frame Alignment Status Badge with exact millisecond drift */}
        {inPoint !== null && keyframes.length > 0 && driftMs !== null && (
          <button
            onClick={onSnapInToKeyframe}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md font-mono text-[10px] border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer ${
              isKeyframeAligned
                ? "bg-white/[0.08] border-white/25 text-white"
                : "bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-white hover:border-white/20"
            }`}
            title={
              isKeyframeAligned
                ? "In-point is accurately aligned to physical GOP I-frame (zero demux offset)"
                : `Drift from GOP boundary: ${driftMs > 0 ? "+" : ""}${driftMs.toFixed(0)}ms. Click to snap to nearest I-frame`
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isKeyframeAligned ? "bg-white" : "bg-zinc-500"
              }`}
            />
            <span>
              {isKeyframeAligned
                ? "I-FRAME"
                : `ALIGN (${driftMs > 0 ? "+" : ""}${driftMs.toFixed(0)}ms)`}
            </span>
          </button>
        )}
      </div>

      {/* Center: Audio Track, Silence Threshold, Auto-Detect & Highlight Reel */}
      <div className="flex items-center gap-2">
        {audioTracks.length > 1 && (
          <div className="flex items-center gap-1 bg-white/[0.04] px-2 py-1 rounded-md border border-white/[0.08] text-[11px] text-zinc-300">
            <Disc className="w-3 h-3 text-zinc-400" />
            <select
              aria-label="Select audio track"
              title="Select Audio Track"
              value={selectedTrackIndex}
              onChange={(e) => onSelectTrack(Number(e.target.value))}
              className="bg-transparent text-zinc-200 text-[11px] focus:outline-none focus-visible:ring-1 focus-visible:ring-white rounded cursor-pointer"
            >
              {audioTracks.map((t) => (
                <option key={t.track_index} value={t.track_index} className="bg-zinc-900">
                  {t.title ? `${t.title}` : `Track A${t.track_index + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Silence Threshold Slider */}
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Sliders className="w-3.5 h-3.5 text-zinc-400" />
          <label htmlFor="silence-threshold" className="text-zinc-400 cursor-pointer">
            Threshold
          </label>
          <input
            id="silence-threshold"
            type="range"
            min="-50"
            max="-15"
            step="1"
            value={noiseDb}
            onChange={(e) => onNoiseDbChange(Number(e.target.value))}
            aria-label="Silence threshold"
            title={`Silence Threshold: ${noiseDb}dB`}
            className="w-20 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          />
          <span className="font-mono text-[11px] text-zinc-200 w-11 text-right tabular-nums">
            {noiseDb} dB
          </span>

          {/* Minimum Silence Duration Selector */}
          <select
            aria-label="Minimum silence duration"
            value={minSilenceDuration}
            onChange={(e) => onMinSilenceDurationChange(Number(e.target.value))}
            className="bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 border border-white/[0.08] rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer"
            title="Minimum Pause Duration to Treat as Silence"
          >
            <option value={0.3} className="bg-zinc-900">Min 0.3s</option>
            <option value={0.5} className="bg-zinc-900">Min 0.5s</option>
            <option value={0.8} className="bg-zinc-900">Min 0.8s</option>
            <option value={1.2} className="bg-zinc-900">Min 1.2s</option>
          </select>

          {/* Auto Calibration Button */}
          <button
            onClick={onAutoCalibrateNoiseFloor}
            disabled={isCalibrating}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 border border-white/[0.08] text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer disabled:opacity-40 transition"
            title="Analyze background noise floor via volumedetect and calculate optimal threshold"
          >
            <Activity className={`w-3 h-3 ${isCalibrating ? "animate-spin text-white" : "text-zinc-400"}`} />
            <span>{isCalibrating ? "Calibrating..." : "Auto Detect"}</span>
          </button>

          {/* Purge / Restore Speech Segments */}
          <button
            onClick={onStripSilence}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 border border-white/[0.08] text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer transition"
            title="Recompute and restore all non-silent speech clips from current silence intervals"
          >
            <Scissors className="w-3 h-3 text-zinc-400" />
            <span>Strip Silence ({silenceCount})</span>
          </button>
        </div>

        {/* Multimodal Peak Highlights & Highlight Reel Builder */}
        {highlightCount > 0 && (
          <div className="flex items-center gap-1">
            <button
              onClick={onNextHighlight}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 border border-white/[0.08] text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer transition"
              title="Jump to Next Peak Highlight (H)"
            >
              <Sparkles className="w-3 h-3 text-zinc-300" />
              <span>Peak ({highlightCount})</span>
            </button>
            <button
              onClick={onBuildHighlightReel}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-white text-black hover:bg-zinc-200 font-medium text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer transition"
              title="Convert all detected multimodal peaks into active highlight clips (-2.5s to +4.5s around each peak) for instant Highlight Reel export (Ctrl+Z to Undo)"
            >
              <Flame className="w-3 h-3" />
              <span>Reel</span>
            </button>
          </div>
        )}
      </div>

      {/* Right: Compression Summary & Timeline Zoom */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-400">
            Kept{" "}
            <strong className="text-zinc-200 font-medium font-mono tabular-nums">
              {totalKeptSec.toFixed(1)}s
            </strong>
          </span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-400">
            Saved{" "}
            <strong className="text-white font-medium font-mono tabular-nums">
              {savedSec.toFixed(1)}s
            </strong>
          </span>
        </div>

        <div className="h-3.5 w-px bg-white/[0.08]" />

        <div className="flex items-center gap-1">
          <button
            onClick={onZoomOut}
            disabled={zoomLevel <= 1}
            aria-label="Zoom out timeline (-)"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:opacity-30 cursor-pointer"
            title="Zoom Out (- or Mouse Wheel)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-[11px] text-zinc-300 w-8 text-center tabular-nums">
            {zoomLevel}x
          </span>
          <button
            onClick={onZoomIn}
            disabled={zoomLevel >= 16}
            aria-label="Zoom in timeline (+)"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:opacity-30 cursor-pointer"
            title="Zoom In (+ or Mouse Wheel)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
