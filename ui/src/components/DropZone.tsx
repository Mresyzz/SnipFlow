import React, { useState } from "react";
import { UploadCloud, Film, Loader2 } from "lucide-react";

interface DropZoneProps {
  onFileSelected: (filePath: string, fileBlobUrl?: string) => void;
  isLoading: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({ onFileSelected, isLoading }) => {
  const [isDragOver, setIsDragOver] = useState(false);

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
      // In webview / browser, create blob URL for instant preview playback
      const blobUrl = URL.createObjectURL(file);
      // For Tauri, file path can often be obtained via webkitRelativePath or path attribute
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
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative w-full h-full flex flex-col items-center justify-center border-2 border-dashed rounded-xl transition-all duration-200 ${
        isDragOver
          ? "border-cyan-400 bg-cyan-400/5"
          : "border-dark-700 hover:border-dark-700/80 bg-dark-900/60"
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
        <div className="flex flex-col items-center gap-4 text-neutral-300">
          <Loader2 className="w-12 h-12 text-cyan-400 animate-spin" />
          <div className="text-center">
            <p className="text-base font-medium">Extracting Keyframes & Analyzing Silence...</p>
            <p className="text-xs text-neutral-500 mt-1">Zero-decode stream scanning in background</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center px-6">
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
          <span className="inline-block text-xs uppercase tracking-wider px-3 py-1 bg-dark-800 text-neutral-400 rounded-md border border-dark-700 font-mono">
            Or Click to Browse
          </span>
        </div>
      )}
    </div>
  );
};
