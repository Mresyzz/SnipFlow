import React from "react";
import { Magnet, Scissors, MicOff, Download, CheckCircle, Clock, ZoomIn, ZoomOut } from "lucide-react";

interface ToolbarProps {
  inPoint: number | null;
  outPoint: number | null;
  currentTime: number;
  isMagneticSnapEnabled: boolean;
  noiseDb: number;
  zoomLevel: number;
  isExporting: boolean;
  lastExportElapsedMs: number | null;
  silenceCount: number;
  onToggleMagneticSnap: () => void;
  onNoiseDbChange: (db: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onStripSilence: () => void;
  onExport: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  inPoint,
  outPoint,
  currentTime,
  isMagneticSnapEnabled,
  noiseDb,
  zoomLevel,
  isExporting,
  lastExportElapsedMs,
  silenceCount,
  onToggleMagneticSnap,
  onNoiseDbChange,
  onZoomIn,
  onZoomOut,
  onMarkIn,
  onMarkOut,
  onStripSilence,
  onExport,
}) => {
  const selectionDuration =
    inPoint !== null && outPoint !== null ? Math.max(0, outPoint - inPoint) : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 bg-dark-900 border border-dark-800 rounded-xl shadow-lg">
      {/* Left section: In/Out points & Snapping */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleMagneticSnap}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
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
            className="px-2.5 py-1 rounded bg-dark-850 hover:bg-dark-800 border border-dark-700 text-xs font-mono text-neutral-300 hover:text-cyan-400 transition"
            title="Mark In Point [I]"
          >
            [ In: {inPoint !== null ? inPoint.toFixed(2) + "s" : "--"}
          </button>
          <button
            onClick={onMarkOut}
            className="px-2.5 py-1 rounded bg-dark-850 hover:bg-dark-800 border border-dark-700 text-xs font-mono text-neutral-300 hover:text-cyan-400 transition"
            title="Mark Out Point [O]"
          >
            Out: {outPoint !== null ? outPoint.toFixed(2) + "s" : "--"} ]
          </button>

          {selectionDuration !== null && (
            <span className="text-xs font-mono text-cyan-400 ml-1">
              ({selectionDuration.toFixed(2)}s)
            </span>
          )}

          <span className="text-[11px] font-mono text-neutral-500 ml-2">
            Pos: {currentTime.toFixed(2)}s
          </span>
        </div>

        {/* Timeline Zoom Controls */}
        <div className="flex items-center gap-1 ml-1 bg-dark-850 px-1.5 py-0.5 rounded border border-dark-750">
          <button
            onClick={onZoomOut}
            disabled={zoomLevel <= 1}
            className="p-1 hover:text-cyan-400 disabled:opacity-30 text-neutral-400 transition"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono text-neutral-400 px-1">{zoomLevel}x</span>
          <button
            onClick={onZoomIn}
            disabled={zoomLevel >= 8}
            className="p-1 hover:text-cyan-400 disabled:opacity-30 text-neutral-400 transition"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Middle section: Silence Stripper Tuning */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <MicOff className="w-3.5 h-3.5 text-danger-500" />
          <span>Threshold:</span>
          <span className="font-mono text-neutral-200">{noiseDb} dB</span>
          <input
            type="range"
            min="-50"
            max="-15"
            step="1"
            value={noiseDb}
            onChange={(e) => onNoiseDbChange(Number(e.target.value))}
            className="w-24 h-1.5 bg-dark-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>

        <button
          onClick={onStripSilence}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-danger-500/10 hover:bg-danger-500/20 border border-danger-500/30 text-xs font-medium text-danger-500 transition cursor-pointer"
          title="Auto-select first active speech segment"
        >
          <Scissors className="w-3.5 h-3.5" />
          <span>Strip Dead-Air ({silenceCount})</span>
        </button>
      </div>

      {/* Right section: Instant Export */}
      <div className="flex items-center gap-3">
        {lastExportElapsedMs !== null && (
          <div className="flex items-center gap-1.5 text-xs text-green-400 font-mono">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Exported in {lastExportElapsedMs.toFixed(1)}ms</span>
          </div>
        )}

        <button
          onClick={onExport}
          disabled={isExporting}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-dark-950 font-semibold text-xs transition shadow-md shadow-cyan-500/20 disabled:opacity-50 cursor-pointer"
          title="Instant Lossless Cut [Enter]"
        >
          {isExporting ? (
            <>
              <Clock className="w-3.5 h-3.5 animate-spin" />
              <span>Copying Streams...</span>
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
