import React, { useState, useCallback, useEffect } from "react";
import { DropZone } from "./components/DropZone";
import { VideoPlayer } from "./components/VideoPlayer";
import { TimelineCanvas } from "./components/TimelineCanvas";
import { Toolbar } from "./components/Toolbar";
import { useShortcuts } from "./hooks/useShortcuts";
import {
  MediaInspection,
  CutResult,
  BatchExportResult,
  SeamlessMergeResult,
  EnvironmentStatus,
  AudioStreamInfo,
  AudioVolumeProfile,
  CutMode,
} from "./types";
import { AlertTriangle, FolderOpen, Play, X, Scissors } from "lucide-react";

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
  const [customOutputDir, setCustomOutputDir] = useState<string | null>(null);

  // Tri-State Cut Engine and Auto-Calibration states
  const [cutMode, setCutMode] = useState<CutMode>("smart_copy");
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);

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

  // Load and inspect media file via Tauri IPC (Real backend stream demuxing)
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

          const audioNote =
            res.audio_tracks.length === 0
              ? " (SILENT VIDEO: NO AUDIO TRACKS)"
              : ` · ${res.audio_tracks.length} TRACKS`;

          setStatusMessage(
            `PARSED: ${res.keyframes.length} I-FRAMES · ${res.silence_intervals.length} SILENCES${audioNote}`
          );
        } else {
          // Browser environment fallback
          if (blobUrl) setVideoUrl(blobUrl);
          setStatusMessage("RUNNING IN BROWSER: DESKTOP TAURI RUNTIME REQUIRED FOR STREAM DEMUXING");
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

  // Pick custom output destination directory
  const handleSelectOutputDir = useCallback(async () => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const dir = await invoke<string | null>("select_output_directory_cmd");
        if (dir) {
          setCustomOutputDir(dir);
          setStatusMessage(`OUTPUT DIRECTORY: ${dir}`);
        }
      } catch (e) {
        console.error("Directory dialog error:", e);
      }
    }
  }, []);

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

  // Auto calibrate background noise floor using FFmpeg volumedetect
  const handleAutoCalibrateNoiseFloor = useCallback(async () => {
    if (!filePath) return;
    setIsCalibrating(true);
    setStatusMessage("PROBING AUDIO VOLUME PROFILE (volumedetect)...");

    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const profile = await invoke<AudioVolumeProfile>("calibrate_silence_threshold_cmd", {
          filePath,
          trackIndex: selectedTrackIndex,
        });

        setNoiseDb(profile.recommended_silence_db);

        const silences = await invoke<[number, number][]>("rescan_silence_cmd", {
          filePath,
          noiseDb: profile.recommended_silence_db,
          minSilenceDuration: 0.5,
          trackIndex: selectedTrackIndex,
        });
        setSilenceIntervals(silences);

        setStatusMessage(
          `AUTO-CALIBRATED: MEAN ${profile.mean_volume_db}dB · MAX ${profile.max_volume_db}dB · REC ${profile.recommended_silence_db}dB`
        );
      }
    } catch (e) {
      console.error("Auto calibration failed", e);
      setStatusMessage(`CALIBRATION FAILED: ${e}`);
    } finally {
      setIsCalibrating(false);
    }
  }, [filePath, selectedTrackIndex]);

  // Toggle Cut Engine Mode (stream_copy -> smart_copy -> exact_frame)
  const handleToggleCutMode = useCallback(() => {
    setCutMode((prev) => {
      const next: CutMode =
        prev === "stream_copy"
          ? "smart_copy"
          : prev === "smart_copy"
          ? "exact_frame"
          : "stream_copy";
      setStatusMessage(
        next === "stream_copy"
          ? "MODE: STREAM COPY (Instant zero-reencoding, snapped to GOP I-frames)"
          : next === "smart_copy"
          ? "MODE: SMART GOP (Micro-renders partial leading GOP + zero-reencode stream copy body)"
          : "MODE: EXACT FRAME (Full segment ultra-fast re-encode)"
      );
      return next;
    });
  }, []);

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

  // Jump to specific segment
  const handleSelectSegment = useCallback((start: number, end: number) => {
    setInPoint(start);
    setOutPoint(end);
    setCurrentTime(start);
    setStatusMessage(`SEEKED SEGMENT: ${start.toFixed(2)}s -> ${end.toFixed(2)}s`);
  }, []);

  // Remove segment from active batch
  const handleRemoveSegment = useCallback((indexToRemove: number) => {
    setActiveSegments((prev) => prev.filter((_, idx) => idx !== indexToRemove));
    setStatusMessage(`REMOVED SEGMENT #${indexToRemove + 1}`);
  }, []);

  // Single cut export
  const handleExport = useCallback(async () => {
    if (!filePath) return;
    const start = inPoint ?? 0;
    const end = outPoint ?? duration;

    if (start >= end) {
      setStatusMessage("INVALID RANGE: IN-POINT MUST PRECEDE OUT-POINT");
      return;
    }

    setIsExporting(true);
    setStatusMessage(
      cutMode === "stream_copy"
        ? "EXECUTING STREAM COPY (-c copy)..."
        : cutMode === "smart_copy"
        ? "EXECUTING HYBRID SMART-GOP CUT (LEADING GOP MICRO-RENDER + STREAM COPY)..."
        : "EXECUTING EXACT FAST RENDER (libx264 ultrafast)..."
    );

    const defaultOutput = customOutputDir
      ? `${customOutputDir}/${filePath.split(/[/\\]/).pop()?.replace(/(\.[^.]+)$/, "_cut$1")}`
      : filePath.replace(/(\.[^.]+)$/, "_cut$1");

    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<CutResult>("lossless_cut_cmd", {
          sourcePath: filePath,
          start,
          end,
          outputPath: defaultOutput,
          cutMode,
        });

        setLastExportElapsedMs(res.elapsed_ms);
        setStatusMessage(
          `EXPORT OK [${cutMode.toUpperCase()}]: ${res.elapsed_ms.toFixed(1)}ms -> ${res.output_path}`
        );
      } else {
        setStatusMessage("DESKTOP TAURI RUNTIME REQUIRED FOR STREAM EXPORT");
      }
    } catch (err) {
      setStatusMessage(`EXPORT FAILED: ${err}`);
    } finally {
      setIsExporting(false);
    }
  }, [filePath, inPoint, outPoint, duration, customOutputDir, cutMode]);

  // Batch multi-clip export
  const handleBatchExport = useCallback(async () => {
    if (!filePath || activeSegments.length === 0) return;

    setIsExporting(true);
    setStatusMessage(`BATCH EXPORTING ${activeSegments.length} CLIPS [${cutMode.toUpperCase()}]...`);

    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<BatchExportResult>("batch_export_segments_cmd", {
          sourcePath: filePath,
          segments: activeSegments,
          outputDirOverride: customOutputDir,
          cutMode,
        });

        setLastExportElapsedMs(res.total_elapsed_ms);
        setStatusMessage(
          `BATCH OK [${cutMode.toUpperCase()}]: ${res.exported_count} CLIPS IN ${res.total_elapsed_ms.toFixed(1)}ms -> ${res.output_dir}`
        );
      } else {
        setStatusMessage("DESKTOP TAURI RUNTIME REQUIRED FOR BATCH EXPORT");
      }
    } catch (err) {
      setStatusMessage(`BATCH EXPORT FAILED: ${err}`);
    } finally {
      setIsExporting(false);
    }
  }, [filePath, activeSegments, customOutputDir, cutMode]);

  // Seamless merge export
  const handleSeamlessMerge = useCallback(async () => {
    if (!filePath || activeSegments.length === 0) return;

    setIsExporting(true);
    setStatusMessage(`SEAMLESS CONCATENATING ${activeSegments.length} ACTIVE SEGMENTS [${cutMode.toUpperCase()}]...`);

    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<SeamlessMergeResult>("export_seamless_merge_cmd", {
          sourcePath: filePath,
          segments: activeSegments,
          outputPathOverride: customOutputDir
            ? `${customOutputDir}/${filePath.split(/[/\\]/).pop()?.replace(/(\.[^.]+)$/, "_seamless_clean$1")}`
            : null,
          cutMode,
        });

        setLastExportElapsedMs(res.total_elapsed_ms);
        setStatusMessage(
          `SEAMLESS MERGE OK [${cutMode.toUpperCase()}]: ${res.merged_segments_count} SEGMENTS IN ${res.total_elapsed_ms.toFixed(1)}ms -> ${res.output_path}`
        );
      } else {
        setStatusMessage("DESKTOP TAURI RUNTIME REQUIRED FOR SEAMLESS MERGE");
      }
    } catch (err) {
      setStatusMessage(`SEAMLESS MERGE FAILED: ${err}`);
    } finally {
      setIsExporting(false);
    }
  }, [filePath, activeSegments, customOutputDir, cutMode]);

  // Keyboard shortcuts with in/out boundary sanity
  useShortcuts({
    togglePlay: () => setIsPlaying((prev) => !prev),
    markIn: () => {
      setInPoint(currentTime);
      if (outPoint !== null && currentTime >= outPoint) {
        setOutPoint(Math.min(duration, currentTime + 5.0));
      }
    },
    markOut: () => {
      setOutPoint(currentTime);
      if (inPoint !== null && currentTime <= inPoint) {
        setInPoint(Math.max(0, currentTime - 5.0));
      }
    },
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

      {/* Industrial Studio Header Bar */}
      <header className="h-[30px] px-3 bg-zinc-900/95 border-b border-zinc-800 flex items-center justify-between font-mono text-xs shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold tracking-widest text-zinc-100 text-[11px]">SNIPFLOW</span>
          <span className="text-zinc-600">/</span>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">v0.3.2</span>
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
          <span
            className={
              cutMode === "stream_copy"
                ? "text-cyan-400 font-semibold"
                : cutMode === "smart_copy"
                ? "text-emerald-400 font-semibold"
                : "text-purple-400 font-semibold"
            }
          >
            MODE:{" "}
            {cutMode === "stream_copy"
              ? "STREAM COPY (PASSTHROUGH)"
              : cutMode === "smart_copy"
              ? "SMART GOP (HYBRID MICRO-RENDER)"
              : "EXACT FRAME (FULL RENDER)"}
          </span>
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
                onDragStart={() => setIsPlaying(false)}
              />
            </div>

            {/* Active Segments Ribbon */}
            {activeSegments.length > 0 && (
              <div className="w-full shrink-0 flex items-center gap-1.5 overflow-x-auto py-1 px-1 bg-zinc-950 border border-zinc-855/80 rounded font-mono text-[10px] custom-scrollbar">
                <div className="flex items-center gap-1 text-zinc-500 shrink-0 px-1.5">
                  <Scissors className="w-3 h-3 text-zinc-500" />
                  <span>CLIPS ({activeSegments.length}):</span>
                </div>
                {activeSegments.map(([s, e], idx) => {
                  const clipDur = Math.max(0, e - s);
                  const isCurrent = inPoint !== null && Math.abs(inPoint - s) < 0.2;
                  return (
                    <div
                      key={idx}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded border transition shrink-0 cursor-pointer ${
                        isCurrent
                          ? "bg-cyan-950/40 border-cyan-700 text-cyan-300"
                          : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850"
                      }`}
                      onClick={() => handleSelectSegment(s, e)}
                      title={`Jump to Clip #${idx + 1} (${s.toFixed(2)}s - ${e.toFixed(2)}s)`}
                    >
                      <Play className="w-2.5 h-2.5 opacity-60" />
                      <span>#{idx + 1}</span>
                      <span className="text-zinc-500">{clipDur.toFixed(1)}s</span>
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleRemoveSegment(idx);
                        }}
                        className="hover:text-rose-400 ml-0.5 text-zinc-600 cursor-pointer"
                        title="Exclude clip from export"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

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
                isCalibrating={isCalibrating}
                lastExportElapsedMs={lastExportElapsedMs}
                silenceCount={silenceIntervals.length}
                audioTracks={audioTracks}
                selectedTrackIndex={selectedTrackIndex}
                highlightCount={peakHighlights.length}
                activeSegmentCount={activeSegments.length}
                customOutputDir={customOutputDir}
                cutMode={cutMode}
                onToggleCutMode={handleToggleCutMode}
                onAutoCalibrateNoiseFloor={handleAutoCalibrateNoiseFloor}
                onSelectTrack={handleSelectTrack}
                onToggleMagneticSnap={() => setIsMagneticSnapEnabled(!isMagneticSnapEnabled)}
                onNoiseDbChange={handleNoiseDbChange}
                onZoomIn={() => setZoomLevel((z) => Math.min(8, z * 2))}
                onZoomOut={() => setZoomLevel((z) => Math.max(1, z / 2))}
                onMarkIn={() => {
                  setInPoint(currentTime);
                  if (outPoint !== null && currentTime >= outPoint) {
                    setOutPoint(Math.min(duration, currentTime + 5.0));
                  }
                }}
                onMarkOut={() => {
                  setOutPoint(currentTime);
                  if (inPoint !== null && currentTime <= inPoint) {
                    setInPoint(Math.max(0, currentTime - 5.0));
                  }
                }}
                onSnapInToKeyframe={handleSnapInToKeyframe}
                onStripSilence={handleStripSilence}
                onNextHighlight={handleNextHighlight}
                onSelectOutputDir={handleSelectOutputDir}
                onExport={handleExport}
                onBatchExport={handleBatchExport}
                onSeamlessMerge={handleSeamlessMerge}
              />
            </div>
          </>
        )}
      </main>

      {/* Industrial Status Footer */}
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
