import React, { useState, useCallback, useEffect } from "react";
import { DropZone } from "./components/DropZone";
import { VideoPlayer } from "./components/VideoPlayer";
import { TimelineCanvas } from "./components/TimelineCanvas";
import { Toolbar } from "./components/Toolbar";
import { useShortcuts } from "./hooks/useShortcuts";
import { MediaInspection, CutResult, BatchExportResult, EnvironmentStatus, AudioStreamInfo } from "./types";
import { Film, Zap, Shield, Sparkles, AlertTriangle, FolderOpen } from "lucide-react";

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
  const [statusMessage, setStatusMessage] = useState<string>("Ready");

  // Check multimedia runtime environment on startup
  useEffect(() => {
    async function checkEnv() {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const status = await invoke<EnvironmentStatus>("check_environment_cmd");
          setEnvStatus(status);
        } catch (e) {
          console.error("Failed to check environment:", e);
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
      setStatusMessage("Extracting keyframes, audio tracks & scanning dead-air...");

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
            `Loaded: ${res.keyframes.length} I-frames, ${res.peak_highlights.length} peaks, ${res.audio_tracks.length} tracks, ${res.waveform_peaks?.length || 0} waveform samples`
          );
        } else {
          // Fallback for browser preview testing
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
          // Simulated sinusoidal waveform
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
          setStatusMessage("Loaded in preview mode");
        }
      } catch (err) {
        console.error("Failed to inspect media:", err);
        setStatusMessage(`Error: ${err}`);
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

  // Switch active audio track for silence detection
  const handleSelectTrack = async (trackIdx: number) => {
    setSelectedTrackIndex(trackIdx);
    if (!filePath) return;
    setStatusMessage(`Scanning silence on Audio Track #${trackIdx + 1}...`);

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
        setStatusMessage(`Refreshed: ${silences.length} silences found on Track #${trackIdx + 1}`);
      }
    } catch (e) {
      console.error("Track rescan failed", e);
    }
  };

  // Jump to next peak highlight moment
  const handleNextHighlight = useCallback(() => {
    if (peakHighlights.length === 0) {
      setStatusMessage("No peak highlight moments detected in audio");
      return;
    }
    const nextPeak = peakHighlights.find((p) => p > currentTime + 0.5);
    const target = nextPeak !== undefined ? nextPeak : peakHighlights[0];
    setCurrentTime(target);
    setStatusMessage(`Jumped to Peak Highlight at ${target.toFixed(2)}s`);
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
    setStatusMessage(`Snapped In-point to Keyframe at ${closest.toFixed(3)}s`);
  }, [keyframes, inPoint]);

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
          trackIndex: selectedTrackIndex,
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

  // Execute single lossless cut export
  const handleExport = useCallback(async () => {
    if (!filePath) return;
    const start = inPoint ?? 0;
    const end = outPoint ?? duration;

    if (start >= end) {
      setStatusMessage("Error: In point must be strictly before Out point");
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

  // Execute batch multi-clip export
  const handleBatchExport = useCallback(async () => {
    if (!filePath || activeSegments.length === 0) return;

    setIsExporting(true);
    setStatusMessage(`Batch exporting ${activeSegments.length} clean clips...`);

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
          `Batch export finished! Created ${res.exported_count} clean clips in ${res.total_elapsed_ms.toFixed(1)}ms! Directory: ${res.output_dir}`
        );
      } else {
        await new Promise((r) => setTimeout(r, 180));
        setLastExportElapsedMs(210.5);
        setStatusMessage(`Simulated batch export finished! Created ${activeSegments.length} clips`);
      }
    } catch (err) {
      setStatusMessage(`Batch export error: ${err}`);
    } finally {
      setIsExporting(false);
    }
  }, [filePath, activeSegments]);

  // Bind keyboard shortcuts
  useShortcuts({
    togglePlay: () => setIsPlaying((prev) => !prev),
    markIn: () => setInPoint(currentTime),
    markOut: () => setOutPoint(currentTime),
    triggerExport: handleExport,
    onNextHighlight: handleNextHighlight,
    stepFrameForward: () => setCurrentTime((t) => Math.min(duration, t + 0.04)),
    stepFrameBackward: () => setCurrentTime((t) => Math.max(0, t - 0.04)),
  });

  return (
    <div className="flex flex-col h-screen w-screen bg-dark-950 text-neutral-200">
      {/* Top Warning Banner if FFmpeg is missing */}
      {envStatus && !envStatus.ffmpeg_available && (
        <div className="flex items-center justify-between px-4 py-2 bg-danger-500/10 border-b border-danger-500/30 text-danger-500 text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              FFmpeg binaries not found. Please place <code>ffmpeg.exe</code> and <code>ffprobe.exe</code> into:{" "}
              <strong>{envStatus.internal_bin_dir}</strong>
            </span>
          </div>
          <button
            onClick={() => alert(`Please copy ffmpeg.exe & ffprobe.exe into: ${envStatus.internal_bin_dir}`)}
            className="flex items-center gap-1 px-2.5 py-1 bg-dark-850 hover:bg-dark-800 text-neutral-200 border border-dark-750 rounded text-[11px] cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Show Location</span>
          </button>
        </div>
      )}

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
                Lossless v0.3.0
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
                peakHighlights={peakHighlights}
                waveformPeaks={waveformPeaks}
                isMagneticSnapEnabled={isMagneticSnapEnabled}
                zoomLevel={zoomLevel}
                onSeek={(t) => setCurrentTime(t)}
              />
            </div>

            {/* Action Toolbar */}
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
          <span>
            <kbd className="px-1 py-0.5 rounded bg-dark-800 text-neutral-300">Space</kbd> Play
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-dark-800 text-neutral-300">←/→</kbd> Step
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-dark-800 text-neutral-300">I</kbd> In
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-dark-800 text-neutral-300">O</kbd> Out
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-dark-800 text-neutral-300">H</kbd> Next Peak
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-dark-800 text-neutral-300">Enter</kbd> Export
          </span>
        </div>
      </footer>
    </div>
  );
};
