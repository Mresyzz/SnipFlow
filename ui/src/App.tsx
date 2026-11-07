import React, { useState, useCallback } from "react";
import { DropZone } from "./components/DropZone";
import { VideoPlayer } from "./components/VideoPlayer";
import { TimelineCanvas } from "./components/TimelineCanvas";
import { Toolbar } from "./components/Toolbar";
import { useShortcuts } from "./hooks/useShortcuts";
import { MediaInspection, CutResult } from "./types";
import { Film, Zap, Shield, Sparkles } from "lucide-react";

export const App: React.FC = () => {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const [keyframes, setKeyframes] = useState<number[]>([]);
  const [silenceIntervals, setSilenceIntervals] = useState<[number, number][]>([]);
  const [activeSegments, setActiveSegments] = useState<[number, number][]>([]);

  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);
  const [isMagneticSnapEnabled, setIsMagneticSnapEnabled] = useState<boolean>(true);
  const [noiseDb, setNoiseDb] = useState<number>(-30);

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [lastExportElapsedMs, setLastExportElapsedMs] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("Ready");

  // Load and inspect media file via Tauri IPC or Browser Fallback
  const handleFileSelected = async (selectedPath: string, blobUrl?: string) => {
    setFilePath(selectedPath);
    if (blobUrl) {
      setVideoUrl(blobUrl);
    }
    setIsLoading(true);
    setStatusMessage("Extracting keyframes & scanning dead-air...");

    try {
      // Check if Tauri invoke is available
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<MediaInspection>("inspect_media_cmd", {
          filePath: selectedPath,
          noiseDb,
          minSilenceDuration: 0.5,
        });

        setDuration(res.duration);
        setKeyframes(res.keyframes);
        setSilenceIntervals(res.silence_intervals);
        setActiveSegments(res.active_segments);

        // Pre-select first active speech segment if available
        if (res.active_segments.length > 0) {
          setInPoint(res.active_segments[0][0]);
          setOutPoint(res.active_segments[0][1]);
        } else {
          setInPoint(0);
          setOutPoint(Math.min(res.duration, 10));
        }
        setStatusMessage(`Loaded: ${res.keyframes.length} I-frames, ${res.silence_intervals.length} silences`);
      } else {
        // Fallback for browser preview testing
        const simulatedDuration = 120;
        setDuration(simulatedDuration);
        const dummyKeyframes = Array.from({ length: 40 }, (_, i) => i * 3);
        setKeyframes(dummyKeyframes);
        const dummySilences: [number, number][] = [
          [12, 18],
          [45, 52],
          [88, 96],
        ];
        setSilenceIntervals(dummySilences);
        setInPoint(18);
        setOutPoint(45);
        setStatusMessage("Loaded in browser preview mode");
      }
    } catch (err) {
      console.error("Failed to inspect media:", err);
      setStatusMessage(`Error: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Re-scan silence when noiseDb slider adjusts
  const handleNoiseDbChange = async (newDb: number) => {
    setNoiseDb(newDb);
    if (!filePath) return;

    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const silences = await invoke<[number, number][]>("rescan_silence_cmd", {
          filePath,
          noiseDb: newDb,
          minSilenceDuration: 0.5,
        });
        setSilenceIntervals(silences);
      }
    } catch (e) {
      console.error("Rescan failed", e);
    }
  };

  // Strip silence action: jump to and set In/Out across first speech segment
  const handleStripSilence = useCallback(() => {
    if (activeSegments.length > 0) {
      const [start, end] = activeSegments[0];
      setInPoint(start);
      setOutPoint(end);
      setCurrentTime(start);
      setStatusMessage(`Selected active content segment: ${start.toFixed(2)}s -> ${end.toFixed(2)}s`);
    } else {
      setStatusMessage("No dead-air intervals detected to purge");
    }
  }, [activeSegments]);

  // Execute lossless cut export
  const handleExport = useCallback(async () => {
    if (!filePath) return;
    const start = inPoint ?? 0;
    const end = outPoint ?? duration;

    if (start >= end) {
      setStatusMessage("Error: In point must be before Out point");
      return;
    }

    setIsExporting(true);
    setStatusMessage("Executing stream copy (-c copy)...");

    const defaultOutput = filePath.replace(/(\.[^.]+)$/, "_cut$1");

    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<CutResult>("lossless_cut_cmd", {
          sourcePath: filePath,
          start,
          end,
          outputPath: defaultOutput,
        });

        setLastExportElapsedMs(res.elapsed_ms);
        setStatusMessage(`Instant export finished in ${res.elapsed_ms.toFixed(1)}ms! Output: ${res.output_path}`);
      } else {
        // Browser demo mock
        await new Promise((r) => setTimeout(r, 90));
        setLastExportElapsedMs(88.4);
        setStatusMessage(`Simulated lossless cut finished in 88.4ms`);
      }
    } catch (err) {
      setStatusMessage(`Export error: ${err}`);
    } finally {
      setIsExporting(false);
    }
  }, [filePath, inPoint, outPoint, duration]);

  // Bind keyboard shortcuts
  useShortcuts({
    togglePlay: () => setIsPlaying((prev) => !prev),
    markIn: () => setInPoint(currentTime),
    markOut: () => setOutPoint(currentTime),
    triggerExport: handleExport,
    stepFrameForward: () => setCurrentTime((t) => Math.min(duration, t + 0.04)),
    stepFrameBackward: () => setCurrentTime((t) => Math.max(0, t - 0.04)),
  });

  return (
    <div className="flex flex-col h-screen w-screen bg-dark-950 text-neutral-200">
      {/* Top Navigation Bar */}
      <header className="flex items-center justify-between px-5 py-2.5 bg-dark-900 border-b border-dark-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
            <Film className="w-4 h-4 text-dark-950" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide text-neutral-100 flex items-center gap-1.5">
              SnipFlow
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-dark-800 text-cyan-400 border border-dark-700">
                Lossless
              </span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-neutral-400 font-mono">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            <span>0.1s Stream Copy</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-green-400" />
            <span>100% Local-First</span>
          </div>
        </div>
      </header>

      {/* Main Workspace Body */}
      <main className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
        {!filePath ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <DropZone onFileSelected={handleFileSelected} isLoading={isLoading} />
          </div>
        ) : (
          <>
            {/* Video Viewport Area */}
            <div className="flex-1 min-h-0 w-full flex items-center justify-center">
              {videoUrl ? (
                <VideoPlayer
                  src={videoUrl}
                  isPlaying={isPlaying}
                  currentTime={currentTime}
                  duration={duration}
                  onTimeUpdate={setCurrentTime}
                  onTogglePlay={() => setIsPlaying(!isPlaying)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-dark-900/50 rounded-xl border border-dark-800">
                  <Film className="w-12 h-12 text-neutral-600 animate-pulse" />
                </div>
              )}
            </div>

            {/* Timeline Canvas Container */}
            <div className="w-full bg-dark-900 p-2.5 rounded-xl border border-dark-800 flex flex-col gap-2">
              <TimelineCanvas
                duration={duration}
                currentTime={currentTime}
                inPoint={inPoint}
                outPoint={outPoint}
                keyframes={keyframes}
                silenceIntervals={silenceIntervals}
                isMagneticSnapEnabled={isMagneticSnapEnabled}
                onSeek={(t) => setCurrentTime(t)}
              />
            </div>

            {/* Action Toolbar */}
            <Toolbar
              inPoint={inPoint}
              outPoint={outPoint}
              currentTime={currentTime}
              isMagneticSnapEnabled={isMagneticSnapEnabled}
              noiseDb={noiseDb}
              isExporting={isExporting}
              lastExportElapsedMs={lastExportElapsedMs}
              silenceCount={silenceIntervals.length}
              onToggleMagneticSnap={() => setIsMagneticSnapEnabled(!isMagneticSnapEnabled)}
              onNoiseDbChange={handleNoiseDbChange}
              onMarkIn={() => setInPoint(currentTime)}
              onMarkOut={() => setOutPoint(currentTime)}
              onStripSilence={handleStripSilence}
              onExport={handleExport}
            />
          </>
        )}
      </main>

      {/* Bottom Status / Keyboard Hint Bar */}
      <footer className="flex items-center justify-between px-4 py-1.5 bg-dark-900 border-t border-dark-800 text-[11px] text-neutral-500 font-mono">
        <div className="flex items-center gap-2 truncate">
          <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
          <span className="truncate text-neutral-400">{statusMessage}</span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span><kbd className="px-1 py-0.5 rounded bg-dark-800 text-neutral-300">Space</kbd> Play</span>
          <span><kbd className="px-1 py-0.5 rounded bg-dark-800 text-neutral-300">I</kbd> In</span>
          <span><kbd className="px-1 py-0.5 rounded bg-dark-800 text-neutral-300">O</kbd> Out</span>
          <span><kbd className="px-1 py-0.5 rounded bg-dark-800 text-neutral-300">Enter</kbd> Export</span>
        </div>
      </footer>
    </div>
  );
};
