import React, { useState } from "react";
import { Loader2, Crosshair, FolderOpen } from "lucide-react";

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
      className={`relative w-full h-full flex flex-col items-center justify-center rounded bg-zinc-950 border transition-all cursor-pointer select-none ${
        isDragOver
          ? "border-cyan-500 bg-cyan-950/10"
          : "border-zinc-800/80 hover:border-zinc-700 bg-zinc-950/80"
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
        <div className="flex flex-col items-center gap-3 text-zinc-300 pointer-events-none">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
          <div className="text-center font-mono">
            <p className="text-xs uppercase tracking-wider text-zinc-200">Demuxing Stream Metadata...</p>
            <p className="text-[11px] text-zinc-500 mt-1">Indexing I-frames & scanning silence intervals</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center px-6 pointer-events-none">
          {/* Studio Monitor Standby Reticle */}
          <div className="relative w-20 h-20 rounded border border-zinc-800 bg-zinc-900/60 flex items-center justify-center">
            <Crosshair className={`w-8 h-8 ${isDragOver ? "text-cyan-400 animate-pulse" : "text-zinc-600"}`} />
            <div className="absolute top-1 left-1.5 text-[9px] font-mono text-zinc-600">SRC</div>
            <div className="absolute bottom-1 right-1.5 text-[9px] font-mono text-zinc-600">RAW</div>
          </div>

          <div>
            <h3 className="text-sm font-semibold tracking-wide uppercase font-mono text-zinc-200">
              No Media Loaded
            </h3>
            <p className="text-xs font-mono text-zinc-500 mt-1">
              Drop video asset or browse local filesystem
            </p>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <span className="flex items-center gap-1.5 px-3 py-1 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 text-xs font-mono rounded border border-zinc-750 transition shadow-sm">
              <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
              <span>Select File</span>
            </span>
          </div>

          <div className="flex items-center gap-2 mt-4 text-[10px] font-mono text-zinc-600">
            <span>MP4 / MKV / MOV / WEBM</span>
            <span>·</span>
            <span>H.264 / HEVC / AV1 / PRORES</span>
          </div>
        </div>
      )}
    </div>
  );
};
