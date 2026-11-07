import React, { useState, useCallback, useEffect } from "react";
import { DropZone } from "./components/DropZone";
import { VideoPlayer } from "./components/VideoPlayer";
import { TimelineCanvas } from "./components/TimelineCanvas";
import { Toolbar } from "./components/Toolbar";
import { useShortcuts } from "./hooks/useShortcuts";
import { MediaInspection, CutResult, BatchExportResult, EnvironmentStatus, AudioStreamInfo } from "./types";
import { AlertTriangle, FolderOpen } from "lucide-react";

export const App: React.FC = () => {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [envStatus, setEnvStatus] = useState<EnvironmentStatus | null>(null);

  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const [keyframes, setKeyframes] = useState<number[]>([]);
  const [silenceIntervals, setSilenceIntervals] = useState<[number, number][]>([]);
  const [activeSegments, setActiveSegments] = useState<[number, number][]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioStreamInfo[]>([]);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0);
  const [peakHighlights, setPeakHighlights] = useState<number[]>([]);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);

  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);
  const [isMagneticSnapEnabled, setIsMagneticSnapEnabled] = useState<boolean>(true);
  const [noiseDb, setNoiseDb] = useState<number>(-30);
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [lastExportElapsedMs, setLastExportElapsedMs] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("READY");

  // Check multimedia runtime environment on startup
  useEffect(() => {
    async function checkEnv() {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const status = await invoke<EnvironmentStatus>("check_environment_cmd");
          setEnvStatus(status);
        } catch (e) {
          console.error("Environment check error:", e);
        }
      }
    }
    checkEnv();
  }, []);

  // Load and inspect media file via Tauri IPC or Browser Fallback
  const handleFileSelected = useCallback(
    async (selectedPath: string, blobUrl?: string) => {
      setFilePath(selectedPath);
      setIsLoading(true);
      setStatusMessage("DEMUXING STREAM & SCANNING INTERVALS...");

      try {
        if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
          const { invoke } = await import("@tauri-apps/api/core");

          try {
            const { convertFileSrc } = await import("@tauri-apps/api/core");
            const assetUrl = convertFileSrc(selectedPath);
            setVideoUrl(assetUrl);
          } catch {
            if (blobUrl) setVideoUrl(blobUrl);
          }

          const res = await invoke<MediaInspection>("inspect_media_cmd", {
            filePath: selectedPath,
            noiseDb,
            minSilenceDuration: 0.5,
            trackIndex: selectedTrackIndex,
          });

          setDuration(res.duration);
          setKeyframes(res.keyframes);
          setSilenceIntervals(res.silence_intervals);
          setActiveSegments(res.active_segments);
          setAudioTracks(res.audio_tracks);
          setPeakHighlights(res.peak_highlights);
          setWaveformPeaks(res.waveform_peaks || []);

          if (res.active_segments.length > 0) {
            setInPoint(res.active_segments[0][0]);
            setOutPoint(res.active_segments[0][1]);
          } else {
            setInPoint(0);
            setOutPoint(Math.min(res.duration, 10));
          }
          setStatusMessage(
            `PARSED: ${res.keyframes.length} I-FRAMES · ${res.silence_intervals.length} SILENCES · ${res.audio_tracks.length} TRACKS`
          );
        } else {
          // Fallback for browser testing
          if (blobUrl) setVideoUrl(blobUrl);
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
          setPeakHighlights([10.5, 33.2, 74.8, 102.1]);
          const dummyWaves = Array.from({ length: 150 }, (_, i) =>
            Math.abs(Math.sin(i / 5) * 0.8 + Math.random() * 0.2)
          );
          setWaveformPeaks(dummyWaves);
          setAudioTracks([
            { stream_index: 1, track_index: 0, codec: "aac", channels: 2, title: "Game Audio" },
            { stream_index: 2, track_index: 1, codec: "aac", channels: 1, title: "Mic Input" },
          ]);
          setInPoint(18);
          setOutPoint(45);
          setStatusMessage("PREVIEW MODE INITIALIZED");
        }
      } catch (err) {
        console.error("Failed to inspect media:", err);
        setStatusMessage(`ERROR: ${err}`);
      } finally {
        setIsLoading(false);
      }
    },
    [noiseDb, selectedTrackIndex]
  );

  // Listen for native OS window file drop events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
          if (event.payload?.paths?.length > 0) {
            handleFileSelected(event.payload.paths[0]);
          }
        }).then((u) => {
          unlisten = u;
        });
      });
    }
    return () => {
      if (unlisten) unlisten();
    };
  }, [handleFileSelected]);

  // Switch active audio track
  const handleSelectTrack = async (trackIdx: number) => {
    setSelectedTrackIndex(trackIdx);
    if (!filePath) return;
    setStatusMessage(`SCANNING TRACK #${trackIdx + 1}...`);

    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const silences = await invoke<[number, number][]>("rescan_silence_cmd", {
          filePath,
          noiseDb,
          minSilenceDuration: 0.5,
          trackIndex: trackIdx,
        });
        setSilenceIntervals(silences);
        setStatusMessage(`REFRESHED: ${silences.length} SILENCES ON TRACK #${trackIdx + 1}`);
      }
    } catch (e) {
      console.error("Track rescan failed", e);
    }
  };

  // Jump to next peak highlight moment
  const handleNextHighlight = useCallback(() => {
    if (peakHighlights.length === 0) {
      setStatusMessage("NO PEAK HIGHLIGHT DETECTED");
      return;
    }
    const nextPeak = peakHighlights.find((p) => p > currentTime + 0.5);
    const target = nextPeak !== undefined ? nextPeak : peakHighlights[0];
    setCurrentTime(target);
    setStatusMessage(`JUMPED TO PEAK AT ${target.toFixed(2)}s`);
  }, [peakHighlights, currentTime]);

  // Snap In-point to closest keyframe (I-frame)
  const handleSnapInToKeyframe = useCallback(() => {
    if (keyframes.length === 0 || inPoint === null) return;
    let closest = keyframes[0];
    let minDiff = Math.abs(keyframes[0] - inPoint);
    for (const kf of keyframes) {
      const diff = Math.abs(kf - inPoint);
      if (diff < minDiff) {
        minDiff = diff;
        closest = kf;
      }
    }
    setInPoint(closest);
    setCurrentTime(closest);
    setStatusMessage(`SNAPPED IN-POINT TO I-FRAME AT ${closest.toFixed(3)}s`);
  }, [keyframes, inPoint]);

  // Re-scan silence on threshold slider adjustment
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
          trackIndex: selectedTrackIndex,
        });
        setSilenceIntervals(silences);
      }
    } catch (e) {
      console.error("Rescan failed", e);
    }
  };

  // Select first active speech segment
  const handleStripSilence = useCallback(() => {
    if (activeSegments.length > 0) {
      const [start, end] = activeSegments[0];
      setInPoint(start);
      setOutPoint(end);
      setCurrentTime(start);
      setStatusMessage(`ACTIVE SEGMENT: ${start.toFixed(2)}s -> ${end.toFixed(2)}s`);
    } else {
      setStatusMessage("NO SILENT INTERVALS DETECTED");
    }
  }, [activeSegments]);

  // Single lossless cut export
  const handleExport = useCallback(async () => {
    if (!filePath) return;
    const start = inPoint ?? 0;
    const end = outPoint ?? duration;

    if (start >= end) {
      setStatusMessage("INVALID RANGE: IN-POINT MUST PRECEDE OUT-POINT");
      return;
    }

    setIsExporting(true);
    setStatusMessage("EXECUTING STREAM COPY (-c copy)...");

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
        setStatusMessage(`EXPORT OK: ${res.elapsed_ms.toFixed(1)}ms -> ${res.output_path}`);
      } else {
        await new Promise((r) => setTimeout(r, 90));
        setLastExportElapsedMs(88.4);
        setStatusMessage(`EXPORT OK: 88.4ms`);
      }
    } catch (err) {
      setStatusMessage(`EXPORT FAILED: ${err}`);
    } finally {
      setIsExporting(false);
    }
  }, [filePath, inPoint, outPoint, duration]);

  // Batch multi-clip export
  const handleBatchExport = useCallback(async () => {
    if (!filePath || activeSegments.length === 0) return;

    setIsExporting(true);
    setStatusMessage(`BATCH EXPORTING ${activeSegments.length} CLIPS...`);

    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<BatchExportResult>("batch_export_segments_cmd", {
          sourcePath: filePath,
          segments: activeSegments,
          outputDirOverride: null,
        });

        setLastExportElapsedMs(res.total_elapsed_ms);
        setStatusMessage(
          `BATCH OK: ${res.exported_count} CLIPS IN ${res.total_elapsed_ms.toFixed(1)}ms -> ${res.output_dir}`
        );
      } else {
        await new Promise((r) => setTimeout(r, 180));
        setLastExportElapsedMs(210.5);
        setStatusMessage(`BATCH OK: ${activeSegments.length} CLIPS`);
      }
    } catch (err) {
      setStatusMessage(`BATCH EXPORT FAILED: ${err}`);
    } finally {
      setIsExporting(false);
    }
  }, [filePath, activeSegments]);

  // Keyboard shortcuts
  useShortcuts({
    togglePlay: () => setIsPlaying((prev) => !prev),
    markIn: () => setInPoint(currentTime),
    markOut: () => setOutPoint(currentTime),
    triggerExport: handleExport,
    onNextHighlight: handleNextHighlight,
    stepFrameForward: () => setCurrentTime((t) => Math.min(duration, t + 0.04)),
    stepFrameBackward: () => setCurrentTime((t) => Math.max(0, t - 0.04)),
  });

  const fileNameOnly = filePath ? filePath.split(/[/\\]/).pop() : null;

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-300 select-none overflow-hidden font-sans">
      {/* Warning Bar if FFmpeg is missing */}
      {envStatus && !envStatus.ffmpeg_available && (
        <div className="flex items-center justify-between px-3 py-1 bg-red-950/40 border-b border-red-900/60 text-red-400 text-xs font-mono">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>FFmpeg binaries not found. Expected in: <strong>{envStatus.internal_bin_dir}</strong></span>
          </div>
          <button
            onClick={() => alert(`Target binary directory: ${envStatus.internal_bin_dir}`)}
            className="flex items-center gap-1 px-2 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[10px] text-zinc-300 cursor-pointer"
          >
            <FolderOpen className="w-3 h-3" />
            <span>Directory</span>
          </button>
        </div>
      )}

      {/* Industrial Studio Header Bar (Compact 30px) */}
      <header className="h-[30px] px-3 bg-zinc-900/95 border-b border-zinc-800 flex items-center justify-between font-mono text-xs shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold tracking-widest text-zinc-100 text-[11px]">SNIPFLOW</span>
          <span className="text-zinc-600">/</span>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">v0.3.0</span>
          {fileNameOnly && (
            <>
              <span className="text-zinc-700">|</span>
              <span className="text-zinc-300 text-[11px] truncate max-w-md">{fileNameOnly}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono">
          <span>ENGINE: RUST/FFMPEG</span>
          <span>·</span>
          <span>PASSTHROUGH: COPY</span>
        </div>
      </header>

      {/* Main Workspace Body */}
      <main className="flex-1 flex flex-col p-2 gap-2 overflow-hidden min-h-0">
        {!filePath ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <DropZone onFileSelected={handleFileSelected} isLoading={isLoading} />
          </div>
        ) : (
          <>
            {/* Monitor Viewport */}
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
                <div className="w-full h-full flex items-center justify-center bg-black rounded border border-zinc-850 font-mono text-xs text-zinc-600">
                  NO VIDEO SIGNAL
                </div>
              )}
            </div>

            {/* Timeline Canvas Section */}
            <div className="w-full shrink-0">
              <TimelineCanvas
                duration={duration}
                currentTime={currentTime}
                inPoint={inPoint}
                outPoint={outPoint}
                keyframes={keyframes}
                silenceIntervals={silenceIntervals}
                peakHighlights={peakHighlights}
                waveformPeaks={waveformPeaks}
                isMagneticSnapEnabled={isMagneticSnapEnabled}
                zoomLevel={zoomLevel}
                onSeek={(t) => setCurrentTime(t)}
              />
            </div>

            {/* Compact Transport Toolbar */}
            <div className="w-full shrink-0">
              <Toolbar
                inPoint={inPoint}
                outPoint={outPoint}
                currentTime={currentTime}
                keyframes={keyframes}
                isMagneticSnapEnabled={isMagneticSnapEnabled}
                noiseDb={noiseDb}
                zoomLevel={zoomLevel}
                isExporting={isExporting}
                lastExportElapsedMs={lastExportElapsedMs}
                silenceCount={silenceIntervals.length}
                audioTracks={audioTracks}
                selectedTrackIndex={selectedTrackIndex}
                highlightCount={peakHighlights.length}
                activeSegmentCount={activeSegments.length}
                onSelectTrack={handleSelectTrack}
                onToggleMagneticSnap={() => setIsMagneticSnapEnabled(!isMagneticSnapEnabled)}
                onNoiseDbChange={handleNoiseDbChange}
                onZoomIn={() => setZoomLevel((z) => Math.min(8, z * 2))}
                onZoomOut={() => setZoomLevel((z) => Math.max(1, z / 2))}
                onMarkIn={() => setInPoint(currentTime)}
                onMarkOut={() => setOutPoint(currentTime)}
                onSnapInToKeyframe={handleSnapInToKeyframe}
                onStripSilence={handleStripSilence}
                onNextHighlight={handleNextHighlight}
                onExport={handleExport}
                onBatchExport={handleBatchExport}
              />
            </div>
          </>
        )}
      </main>

      {/* Industrial Status Footer (Compact 22px) */}
      <footer className="h-[22px] px-3 bg-zinc-950 border-t border-zinc-850 flex items-center justify-between font-mono text-[10px] text-zinc-500 shrink-0">
        <div className="truncate text-zinc-400">
          <span>&gt; {statusMessage}</span>
        </div>

        <div className="flex items-center gap-2.5 text-zinc-500 shrink-0">
          <span><kbd className="px-1 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">SPACE</kbd> PLAY</span>
          <span><kbd className="px-1 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">←/→</kbd> STEP</span>
          <span><kbd className="px-1 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">I</kbd> IN</span>
          <span><kbd className="px-1 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">O</kbd> OUT</span>
          <span><kbd className="px-1 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">ENTER</kbd> EXPORT</span>
        </div>
      </footer>
    </div>
  );
};
