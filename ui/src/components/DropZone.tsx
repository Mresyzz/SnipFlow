import React, { useState } from "react";
import { Loader2, FolderOpen } from "lucide-react";

interface DropZoneProps {
  onFileSelected: (filePath: string, fileBlobUrl?: string) => void;
  isLoading: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({ onFileSelected, isLoading }) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleClickZone = async (e: React.MouseEvent) => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      e.preventDefault();
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const selected = await invoke<string | null>("select_video_file_cmd");
        if (selected) {
          onFileSelected(selected);
        }
      } catch (err) {
        console.error("Native file dialog failed:", err);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const blobUrl = URL.createObjectURL(file);
      const filePath = (file as unknown as { path?: string }).path || file.name;
      onFileSelected(filePath, blobUrl);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const blobUrl = URL.createObjectURL(file);
      const filePath = (file as unknown as { path?: string }).path || file.name;
      onFileSelected(filePath, blobUrl);
    }
  };

  return (
    <div
      onClick={handleClickZone}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative w-full max-w-xl py-16 px-8 flex flex-col items-center justify-center rounded-2xl border transition-all cursor-pointer select-none ${
        isDragOver
          ? "border-white bg-white/[0.06]"
          : "border-white/[0.08] hover:border-white/[0.18] bg-[#111114]"
      }`}
    >
      <input
        type="file"
        accept="video/mp4,video/x-matroska,video/quicktime,video/webm"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        onChange={handleFileInputChange}
        disabled={isLoading}
      />

      {isLoading ? (
        <div className="flex flex-col items-center gap-3 text-zinc-200 pointer-events-none">
          <Loader2 className="w-8 h-8 text-white animate-spin" />
          <div className="text-center">
            <p className="text-sm font-medium text-white">Demuxing Stream Metadata...</p>
            <p className="text-xs text-zinc-500 mt-1 font-mono">
              Indexing GOP keyframes, audio waveform & silence intervals
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center px-6 pointer-events-none">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shadow-inner">
            <img src="/logo.svg" alt="SnipFlow" className="w-8 h-8 rounded-md" />
          </div>

          <div>
            <h2 className="text-sm font-medium text-zinc-100">
              Drop a video file here, or click to browse
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              Supports MP4, MOV, MKV, and WebM with instant lossless stream copy
            </p>
          </div>

          <span className="mt-1 inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-white text-black text-xs font-medium shadow-sm">
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Select Video File</span>
          </span>

          <div className="flex items-center gap-2 mt-2 text-[11px] font-mono text-zinc-500">
            <span>MP4 / MKV / MOV / WEBM</span>
            <span>·</span>
            <span>H.264 / HEVC / AV1 / PRORES</span>
          </div>
        </div>
      )}
    </div>
  );
};
