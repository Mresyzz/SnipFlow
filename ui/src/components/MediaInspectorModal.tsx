import React from "react";
import { X, Film, Volume2, Layers, CheckCircle2, Copy, Check } from "lucide-react";
import { MediaInspection, AudioVolumeProfile } from "../types";

interface MediaInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  inspection: MediaInspection | null;
  volumeProfile: AudioVolumeProfile | null;
  duration: number;
  totalKeptSec: number;
  savedSec: number;
}

export const MediaInspectorModal: React.FC<MediaInspectorModalProps> = ({
  isOpen,
  onClose,
  inspection,
  volumeProfile,
  duration,
  totalKeptSec,
  savedSec,
}) => {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen || !inspection) return null;

  const validation = inspection.validation;
  const keyframeCount = inspection.keyframes.length;
  const avgGopSec = keyframeCount > 1 ? (duration / keyframeCount).toFixed(2) : "--";
  const compressionRatio = duration > 0 ? ((savedSec / duration) * 100).toFixed(1) : "0";

  const handleCopyPath = () => {
    if (inspection.path) {
      navigator.clipboard.writeText(inspection.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1);
    return `${mins}m ${s}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl bg-[#0e0e11] border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-white" />
            <span className="text-sm font-semibold text-white tracking-wide">
              Technical Media Inspector
            </span>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-zinc-400 border border-white/[0.08]">
              {validation?.format_name.toUpperCase() || "MEDIA"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-white/[0.06] transition cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 overflow-y-auto font-sans text-xs text-zinc-300">
          {/* File Path Card */}
          <div className="p-3 rounded-lg bg-black/40 border border-white/[0.06] flex items-center justify-between gap-3">
            <div className="truncate min-w-0">
              <div className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 mb-0.5">
                Source File Path
              </div>
              <div className="font-mono text-zinc-200 text-[11px] truncate" title={inspection.path}>
                {inspection.path}
              </div>
            </div>
            <button
              onClick={handleCopyPath}
              className="flex items-center gap-1 shrink-0 px-2.5 py-1 rounded bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-[11px] text-zinc-300 transition cursor-pointer"
              title="Copy path to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>

          {/* Grid: Video vs Audio streams */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Video Stream Column */}
            <div className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.06] space-y-3">
              <div className="flex items-center gap-2 text-white font-medium pb-2 border-b border-white/[0.06]">
                <Film className="w-3.5 h-3.5" />
                <span>Video Stream</span>
              </div>
              <div className="space-y-2 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Codec</span>
                  <span className="text-zinc-200 font-semibold">{validation?.video_codec?.toUpperCase() || "RAW"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Resolution</span>
                  <span className="text-zinc-200">
                    {validation?.width && validation?.height
                      ? `${validation.width} × ${validation.height}`
                      : "N/A"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Duration</span>
                  <span className="text-zinc-200">{duration.toFixed(2)}s ({formatTime(duration)})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Keyframes (I-Frames)</span>
                  <span className="text-zinc-200">{keyframeCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Average GOP Span</span>
                  <span className="text-zinc-200">~{avgGopSec}s</span>
                </div>
              </div>
            </div>

            {/* Audio Stream Column */}
            <div className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.06] space-y-3">
              <div className="flex items-center gap-2 text-white font-medium pb-2 border-b border-white/[0.06]">
                <Volume2 className="w-3.5 h-3.5" />
                <span>Audio Stream & Tracks</span>
              </div>
              <div className="space-y-2 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Codec</span>
                  <span className="text-zinc-200 font-semibold">{validation?.audio_codec?.toUpperCase() || "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Tracks Detected</span>
                  <span className="text-zinc-200">{inspection.audio_tracks.length} track(s)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Integrated Mean Vol</span>
                  <span className="text-zinc-200">
                    {volumeProfile ? `${volumeProfile.mean_volume_db} dB` : "--"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Max True Peak</span>
                  <span className="text-zinc-200">
                    {volumeProfile ? `${volumeProfile.max_volume_db} dB` : "--"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Calibrated Noise Floor</span>
                  <span className="text-zinc-200 font-semibold text-white">
                    {volumeProfile ? `${volumeProfile.recommended_silence_db} dB` : "--"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Silence & NLE Pre-cut Triage Analytics */}
          <div className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.06] space-y-3">
            <div className="flex items-center gap-2 text-white font-medium pb-2 border-b border-white/[0.06]">
              <Layers className="w-3.5 h-3.5" />
              <span>Silence Removal & Pre-Cut Triage Metrics</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-2.5 rounded bg-black/40 border border-white/[0.04]">
                <div className="text-[10px] text-zinc-500 font-mono uppercase">Silence Gaps</div>
                <div className="text-sm font-semibold text-zinc-200 mt-1">{inspection.silence_intervals.length}</div>
              </div>
              <div className="p-2.5 rounded bg-black/40 border border-white/[0.04]">
                <div className="text-[10px] text-zinc-500 font-mono uppercase">Speech Clips</div>
                <div className="text-sm font-semibold text-zinc-200 mt-1">{inspection.active_segments.length}</div>
              </div>
              <div className="p-2.5 rounded bg-black/40 border border-white/[0.04]">
                <div className="text-[10px] text-zinc-500 font-mono uppercase">Kept Time</div>
                <div className="text-sm font-semibold text-zinc-200 mt-1">{formatTime(totalKeptSec)}</div>
              </div>
              <div className="p-2.5 rounded bg-black/40 border border-white/[0.04]">
                <div className="text-[10px] text-zinc-500 font-mono uppercase">Saved ({compressionRatio}%)</div>
                <div className="text-sm font-semibold text-white mt-1">-{formatTime(savedSec)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/[0.08] bg-white/[0.02] flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-zinc-500 text-[11px]">
            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" />
            <span>Zero-Reencode Lossless Ready</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-white text-black font-medium text-xs hover:bg-zinc-200 transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
