import React, { useState } from "react";
import { UploadCloud, Film, Loader2 } from "lucide-react";

interface DropZoneProps {
  onFileSelected: (filePath: string, fileBlobUrl?: string) => void;
  isLoading: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({ onFileSelected, isLoading }) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleClickZone = async (e: React.MouseEvent) => {
    // If running in Tauri desktop environment, call native system file picker
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
      className={`relative w-full h-full flex flex-col items-center justify-center border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer ${
        isDragOver
          ? "border-cyan-400 bg-cyan-400/5"
          : "border-dark-700 hover:border-cyan-500/50 bg-dark-900/60"
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
        <div className="flex flex-col items-center gap-4 text-neutral-300 pointer-events-none">
          <Loader2 className="w-12 h-12 text-cyan-400 animate-spin" />
          <div className="text-center">
            <p className="text-base font-medium">Extracting Keyframes & Analyzing Silence...</p>
            <p className="text-xs text-neutral-500 mt-1">Zero-decode stream scanning in background</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center px-6 pointer-events-none">
          <div className="w-16 h-16 rounded-2xl bg-dark-850 flex items-center justify-center border border-dark-800 shadow-lg">
            {isDragOver ? (
              <Film className="w-8 h-8 text-cyan-400 animate-pulse" />
            ) : (
              <UploadCloud className="w-8 h-8 text-neutral-400" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-neutral-200">
              Drop Raw Video Here
            </h3>
            <p className="text-sm text-neutral-400 mt-1">
              Supports MP4, MKV, MOV, WebM (4K UHD 60fps & HDR)
            </p>
          </div>
          <span className="inline-block text-xs uppercase tracking-wider px-3 py-1 bg-dark-800 text-cyan-400 rounded-md border border-dark-700 font-mono shadow-sm">
            Or Click to Choose File (Native Dialog)
          </span>
        </div>
      )}
    </div>
  );
};
