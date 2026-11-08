import React, { useState, useCallback, useEffect, useRef } from "react";
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
  NleExportResult,
  EnvironmentStatus,
  AudioStreamInfo,
  AudioVolumeProfile,
  ContainerFormat,
  CutMode,
} from "./types";
import {
  AlertTriangle,
  FolderOpen,
  X,
  Film,
  Undo2,
  Redo2,
  FileCode,
  Download,
  Layers,
  Zap,
  Clock,
} from "lucide-react";

/**
 * Computes active speech intervals by inverting silent intervals with natural breath padding.
 * Matches backend `invert_silence_with_padding` algorithm.
 */
function computeActiveSegmentsWithPadding(
  silenceIntervals: [number, number][],
  totalDuration: number,
  paddingSec: number = 0.06
): [number, number][] {
  if (totalDuration <= 0) return [];
  if (silenceIntervals.length === 0) return [[0, totalDuration]];

  const pad = Math.max(0, paddingSec);
  const active: [number, number][] = [];
  let currentPos = 0.0;

  for (const [silenceStart, silenceEnd] of silenceIntervals) {
    const effStart = silenceStart <= 0.001 ? 0.0 : silenceStart + pad;
    const effEnd =
      Math.abs(totalDuration - silenceEnd) <= 0.001 ? totalDuration : silenceEnd - pad;

    if (effEnd <= effStart) {
      continue;
    }

    if (effStart > currentPos) {
      active.push([currentPos, Math.min(totalDuration, effStart)]);
    }
    currentPos = Math.max(currentPos, effEnd);
  }

  if (currentPos < totalDuration) {
    active.push([currentPos, totalDuration]);
  }

  return active;
}

/**
 * Converts discrete highlight peaks into merged, non-overlapping clip intervals `[peak - pre, peak + post]`.
 */
function buildHighlightSegmentsFromPeaks(
  peaks: number[],
  totalDuration: number,
  preRoll: number = 2.5,
  postRoll: number = 4.5
): [number, number][] {
  if (peaks.length === 0 || totalDuration <= 0) return [];
  const sorted = [...peaks].sort((a, b) => a - b);
  const merged: [number, number][] = [];

  for (const p of sorted) {
    const start = Math.max(0, Number((p - preRoll).toFixed(2)));
    const end = Math.min(totalDuration, Number((p + postRoll).toFixed(2)));
    if (end <= start) continue;

    if (merged.length > 0 && start <= merged[merged.length - 1][1] + 0.25) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/**
 * Safely constructs an export file path across Windows (`\`) and Unix (`/`)
 * while respecting optional custom output directories and container format overrides.
 */
function buildExportFilePath(
  sourcePath: string,
  customDir: string | null,
  suffix: string,
  containerFormat: ContainerFormat
): string {
  const sep = sourcePath.includes("\\") ? "\\" : "/";
  const parts = sourcePath.split(/[/\\]/);
  const fileName = parts.pop() || "video.mp4";
  const dir = customDir ? customDir.replace(/[/\\]+$/, "") : parts.join(sep);

  const dotIdx = fileName.lastIndexOf(".");
  const stem = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  const origExt = dotIdx > 0 ? fileName.slice(dotIdx + 1) : "mp4";
  const targetExt = containerFormat === "auto" ? origExt : containerFormat;

  const outFileName = `${stem}${suffix}.${targetExt}`;
  return dir ? `${dir}${sep}${outFileName}` : outFileName;
}

export const App: React.FC = () => {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [envStatus, setEnvStatus] = useState<EnvironmentStatus | null>(null);

  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [skipSilencePreview, setSkipSilencePreview] = useState<boolean>(false);

  const [keyframes, setKeyframes] = useState<number[]>([]);
  const [silenceIntervals, setSilenceIntervals] = useState<[number, number][]>([]);
  const [activeSegments, setActiveSegments] = useState<[number, number][]>([]);
  const [selectedClipIndex, setSelectedClipIndex] = useState<number | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioStreamInfo[]>([]);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0);
  const [peakHighlights, setPeakHighlights] = useState<number[]>([]);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);

  // Non-destructive Undo / Redo stacks for activeSegments edits
  const [undoStack, setUndoStack] = useState<[number, number][][]>([]);
  const [redoStack, setRedoStack] = useState<[number, number][][]>([]);

  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);
  const [isMagneticSnapEnabled, setIsMagneticSnapEnabled] = useState<boolean>(true);
  const [noiseDb, setNoiseDb] = useState<number>(-30);
  const [minSilenceDuration, setMinSilenceDuration] = useState<number>(0.5);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [customOutputDir, setCustomOutputDir] = useState<string | null>(null);

  // Tri-State Cut Engine, Container Format, and Auto-Calibration states
  const [cutMode, setCutMode] = useState<CutMode>("smart_copy");
  const [containerFormat, setContainerFormat] = useState<ContainerFormat>("auto");
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [lastExportElapsedMs, setLastExportElapsedMs] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("READY");

  // Monotonic request ID & debounce timer for race-condition-free silence rescanning
  const rescanReqIdRef = useRef<number>(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushUndoSnapshot = useCallback((snapshot: [number, number][]) => {
    setUndoStack((prev) => [...prev.slice(-29), snapshot]);
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) {
        setStatusMessage("NOTHING TO UNDO");
        return prevUndo;
      }
      const previousState = prevUndo[prevUndo.length - 1];
      setRedoStack((prevRedo) => [...prevRedo, activeSegments]);
      setActiveSegments(previousState);
      if (previousState.length > 0) {
        const idx = Math.min(selectedClipIndex ?? 0, previousState.length - 1);
        setSelectedClipIndex(idx);
        setInPoint(previousState[idx][0]);
        setOutPoint(previousState[idx][1]);
      }
      setStatusMessage(`UNDO OK -> RESTORED ${previousState.length} CLIPS`);
      return prevUndo.slice(0, -1);
    });
  }, [activeSegments, selectedClipIndex]);

  const handleRedo = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) {
        setStatusMessage("NOTHING TO REDO");
        return prevRedo;
      }
      const nextState = prevRedo[prevRedo.length - 1];
      setUndoStack((prevUndo) => [...prevUndo, activeSegments]);
      setActiveSegments(nextState);
      if (nextState.length > 0) {
        const idx = Math.min(selectedClipIndex ?? 0, nextState.length - 1);
        setSelectedClipIndex(idx);
        setInPoint(nextState[idx][0]);
        setOutPoint(nextState[idx][1]);
      }
      setStatusMessage(`REDO OK -> RESTORED ${nextState.length} CLIPS`);
      return prevRedo.slice(0, -1);
    });
  }, [activeSegments, selectedClipIndex]);

  // Update In-Point and synchronize with active selected clip
  const handleUpdateInPoint = useCallback(
    (newIn: number) => {
      setInPoint(newIn);
      if (selectedClipIndex !== null) {
        setActiveSegments((prev) => {
          if (selectedClipIndex < 0 || selectedClipIndex >= prev.length) return prev;
          const next = [...prev];
          const currentOut = next[selectedClipIndex][1];
          if (newIn < currentOut - 0.05) {
            next[selectedClipIndex] = [newIn, currentOut];
          }
          return next;
        });
      }
    },
    [selectedClipIndex]
  );

  // Update Out-Point and synchronize with active selected clip
  const handleUpdateOutPoint = useCallback(
    (newOut: number) => {
      setOutPoint(newOut);
      if (selectedClipIndex !== null) {
        setActiveSegments((prev) => {
          if (selectedClipIndex < 0 || selectedClipIndex >= prev.length) return prev;
          const next = [...prev];
          const currentIn = next[selectedClipIndex][0];
          if (newOut > currentIn + 0.05) {
            next[selectedClipIndex] = [currentIn, newOut];
          }
          return next;
        });
      }
    },
    [selectedClipIndex]
  );

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

  // Load and inspect media file via Tauri IPC (Parallel multi-thread stream demuxing)
  const handleFileSelected = useCallback(
    async (selectedPath: string, blobUrl?: string) => {
      setFilePath(selectedPath);
      setIsLoading(true);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedClipIndex(0);
      setStatusMessage("PARALLEL DEMUXING STREAM & SCANNING INTERVALS...");

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
            minSilenceDuration,
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
            setSelectedClipIndex(0);
            setInPoint(res.active_segments[0][0]);
            setOutPoint(res.active_segments[0][1]);
          } else {
            setSelectedClipIndex(null);
            setInPoint(0);
            setOutPoint(Math.min(res.duration, 10));
          }

          const audioNote =
            res.audio_tracks.length === 0
              ? " (SILENT VIDEO: VISUAL SCENE HIGHLIGHTS ACTIVE)"
              : ` · ${res.audio_tracks.length} TRACKS`;

          setStatusMessage(
            `PARSED: ${res.keyframes.length} I-FRAMES · ${res.silence_intervals.length} SILENCES${audioNote}`
          );
        } else {
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
    [noiseDb, minSilenceDuration, selectedTrackIndex]
  );

  // Open native file dialog to switch/open another video (Shortcut: Ctrl+O)
  const handleOpenMediaDialog = useCallback(async () => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const selected = await invoke<string | null>("select_video_file_cmd");
        if (selected) {
          handleFileSelected(selected);
        }
      } catch (e) {
        console.error("Open file dialog error:", e);
      }
    }
  }, [handleFileSelected]);

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

  // Race-condition-safe helper for running silence rescan (and optional waveform refresh)
  const executeSilenceRescan = useCallback(
    async (
      targetDb: number,
      targetMinDur: number,
      targetTrack: number,
      refreshWaveform: boolean = false
    ) => {
      if (!filePath) return;
      const reqId = ++rescanReqIdRef.current;

      try {
        if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
          const { invoke } = await import("@tauri-apps/api/core");

          if (refreshWaveform) {
            const [silences, waves] = await Promise.all([
              invoke<[number, number][]>("rescan_silence_cmd", {
                filePath,
                noiseDb: targetDb,
                minSilenceDuration: targetMinDur,
                trackIndex: targetTrack,
              }),
              invoke<number[]>("extract_track_waveform_cmd", {
                filePath,
                trackIndex: targetTrack,
              }),
            ]);

            if (reqId !== rescanReqIdRef.current) return;
            setSilenceIntervals(silences);
            setWaveformPeaks(waves);
            const updatedActive = computeActiveSegmentsWithPadding(silences, duration, 0.06);
            setActiveSegments(updatedActive);
            if (updatedActive.length > 0) {
              setSelectedClipIndex(0);
              setInPoint(updatedActive[0][0]);
              setOutPoint(updatedActive[0][1]);
            }
            setStatusMessage(
              `SWITCHED TRACK #${targetTrack + 1}: ${silences.length} SILENCES · ${updatedActive.length} ACTIVE CLIPS`
            );
          } else {
            const silences = await invoke<[number, number][]>("rescan_silence_cmd", {
              filePath,
              noiseDb: targetDb,
              minSilenceDuration: targetMinDur,
              trackIndex: targetTrack,
            });

            if (reqId !== rescanReqIdRef.current) return;
            setSilenceIntervals(silences);
            const updatedActive = computeActiveSegmentsWithPadding(silences, duration, 0.06);
            setActiveSegments(updatedActive);
            setStatusMessage(
              `RESCANNED (${targetDb}dB, MIN ${targetMinDur}s): ${silences.length} SILENCES · ${updatedActive.length} ACTIVE CLIPS`
            );
          }
        }
      } catch (e) {
        console.error("Rescan failed", e);
      }
    },
    [filePath, duration]
  );

  // Switch active audio track and concurrently recompute silence + waveform envelope
  const handleSelectTrack = async (trackIdx: number) => {
    setSelectedTrackIndex(trackIdx);
    if (!filePath) return;
    setStatusMessage(`SCANNING TRACK #${trackIdx + 1} SILENCE & WAVEFORM...`);
    await executeSilenceRescan(noiseDb, minSilenceDuration, trackIdx, true);
  };

  // Debounced silence threshold slider adjustment (prevents FFmpeg process storm & race conditions)
  const handleNoiseDbChange = useCallback(
    (newDb: number) => {
      setNoiseDb(newDb);
      if (!filePath) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        executeSilenceRescan(newDb, minSilenceDuration, selectedTrackIndex, false);
      }, 180);
    },
    [filePath, minSilenceDuration, selectedTrackIndex, executeSilenceRescan]
  );

  // Adjust minimum silence duration
  const handleMinSilenceDurationChange = useCallback(
    (newMinDur: number) => {
      setMinSilenceDuration(newMinDur);
      if (!filePath) return;
      executeSilenceRescan(noiseDb, newMinDur, selectedTrackIndex, false);
    },
    [filePath, noiseDb, selectedTrackIndex, executeSilenceRescan]
  );

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

  // Convert all detected peak highlights into active highlight reel clips (-2.5s to +4.5s)
  const handleBuildHighlightReel = useCallback(() => {
    if (peakHighlights.length === 0) {
      setStatusMessage("NO PEAK HIGHLIGHTS AVAILABLE FOR REEL");
      return;
    }
    const reelSegments = buildHighlightSegmentsFromPeaks(peakHighlights, duration, 2.5, 4.5);
    if (reelSegments.length === 0) return;

    pushUndoSnapshot(activeSegments);
    setActiveSegments(reelSegments);
    setSelectedClipIndex(0);
    setInPoint(reelSegments[0][0]);
    setOutPoint(reelSegments[0][1]);
    setCurrentTime(reelSegments[0][0]);
    setStatusMessage(
      `BUILT HIGHLIGHT REEL: ${reelSegments.length} CLIPS FROM ${peakHighlights.length} PEAKS (CTRL+Z TO RESTORE)`
    );
  }, [peakHighlights, duration, activeSegments, pushUndoSnapshot]);

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
    pushUndoSnapshot(activeSegments);
    handleUpdateInPoint(closest);
    setCurrentTime(closest);
    setStatusMessage(`SNAPPED IN-POINT TO I-FRAME AT ${closest.toFixed(3)}s`);
  }, [keyframes, inPoint, activeSegments, pushUndoSnapshot, handleUpdateInPoint]);

  // Seek to previous / next I-frame (Shift + Left / Right)
  const handleSeekPrevKeyframe = useCallback(() => {
    if (keyframes.length === 0) return;
    const prev = [...keyframes].reverse().find((kf) => kf < currentTime - 0.05);
    const target = prev !== undefined ? prev : keyframes[0];
    setCurrentTime(target);
    setStatusMessage(`SEEKED PREVIOUS I-FRAME: ${target.toFixed(3)}s`);
  }, [keyframes, currentTime]);

  const handleSeekNextKeyframe = useCallback(() => {
    if (keyframes.length === 0) return;
    const next = keyframes.find((kf) => kf > currentTime + 0.05);
    const target = next !== undefined ? next : keyframes[keyframes.length - 1];
    setCurrentTime(target);
    setStatusMessage(`SEEKED NEXT I-FRAME: ${target.toFixed(3)}s`);
  }, [keyframes, currentTime]);

  // Slice active segment at playhead (Shortcut: X or Split button) with Undo support
  const handleSliceAtPlayhead = useCallback(() => {
    if (activeSegments.length === 0) return;
    const nextSegments: [number, number][] = [];
    let sliced = false;
    let newSelectedIdx = selectedClipIndex;

    for (let i = 0; i < activeSegments.length; i++) {
      const [s, e] = activeSegments[i];
      if (!sliced && currentTime > s + 0.15 && currentTime < e - 0.15) {
        nextSegments.push([s, currentTime]);
        nextSegments.push([currentTime, e]);
        newSelectedIdx = nextSegments.length - 1;
        sliced = true;
      } else {
        nextSegments.push([s, e]);
      }
    }

    if (sliced) {
      pushUndoSnapshot(activeSegments);
      setActiveSegments(nextSegments);
      if (newSelectedIdx !== null && nextSegments[newSelectedIdx]) {
        setSelectedClipIndex(newSelectedIdx);
        setInPoint(nextSegments[newSelectedIdx][0]);
        setOutPoint(nextSegments[newSelectedIdx][1]);
      }
      setStatusMessage(`SPLIT CLIP AT PLAYHEAD (${currentTime.toFixed(2)}s) -> ${nextSegments.length} CLIPS`);
    } else {
      setStatusMessage("PLAYHEAD MUST BE INSIDE AN ACTIVE CLIP TO SPLIT (X)");
    }
  }, [activeSegments, currentTime, selectedClipIndex, pushUndoSnapshot]);

  // Cycle playback speed 1.0x -> 1.5x -> 2.0x -> 4.0x
  const handleCyclePlaybackRate = useCallback(() => {
    setPlaybackRate((prev) => {
      const next = prev === 1.0 ? 1.5 : prev === 1.5 ? 2.0 : prev === 2.0 ? 4.0 : 1.0;
      setStatusMessage(`PLAYBACK SPEED: ${next.toFixed(1)}x`);
      return next;
    });
  }, []);

  // Toggle live skip-silence audition mode
  const handleToggleSkipSilencePreview = useCallback(() => {
    setSkipSilencePreview((prev) => {
      const next = !prev;
      setStatusMessage(
        next
          ? "LIVE SKIP-SILENCE AUDITION: ON (Playback automatically jumps across silent regions)"
          : "LIVE SKIP-SILENCE AUDITION: OFF"
      );
      return next;
    });
  }, []);

  // Auto calibrate background noise floor using FFmpeg volumedetect
  const handleAutoCalibrateNoiseFloor = useCallback(async () => {
    if (!filePath) return;
    setIsCalibrating(true);
    setStatusMessage("PROBING AUDIO VOLUME PROFILE (85Hz-7800Hz Bandpass + volumedetect)...");

    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const profile = await invoke<AudioVolumeProfile>("calibrate_silence_threshold_cmd", {
          filePath,
          trackIndex: selectedTrackIndex,
        });

        setNoiseDb(profile.recommended_silence_db);

        const reqId = ++rescanReqIdRef.current;
        const silences = await invoke<[number, number][]>("rescan_silence_cmd", {
          filePath,
          noiseDb: profile.recommended_silence_db,
          minSilenceDuration,
          trackIndex: selectedTrackIndex,
        });
        if (reqId !== rescanReqIdRef.current) return;

        pushUndoSnapshot(activeSegments);
        setSilenceIntervals(silences);
        const updatedActive = computeActiveSegmentsWithPadding(silences, duration, 0.06);
        setActiveSegments(updatedActive);
        if (updatedActive.length > 0) {
          setSelectedClipIndex(0);
          setInPoint(updatedActive[0][0]);
          setOutPoint(updatedActive[0][1]);
        }

        setStatusMessage(
          `AUTO-CALIBRATED: MEAN ${profile.mean_volume_db}dB · MAX ${profile.max_volume_db}dB · REC ${profile.recommended_silence_db}dB (${updatedActive.length} CLIPS)`
        );
      }
    } catch (e) {
      console.error("Auto calibration failed", e);
      setStatusMessage(`CALIBRATION FAILED: ${e}`);
    } finally {
      setIsCalibrating(false);
    }
  }, [filePath, selectedTrackIndex, minSilenceDuration, duration, activeSegments, pushUndoSnapshot]);

  // Recompute and restore all active speech segments from current silence intervals
  const handleStripSilence = useCallback(() => {
    if (duration <= 0) return;
    const restoredSegments = computeActiveSegmentsWithPadding(silenceIntervals, duration, 0.06);
    if (restoredSegments.length > 0) {
      pushUndoSnapshot(activeSegments);
      setActiveSegments(restoredSegments);
      setSelectedClipIndex(0);
      setInPoint(restoredSegments[0][0]);
      setOutPoint(restoredSegments[0][1]);
      setCurrentTime(restoredSegments[0][0]);
      setStatusMessage(
        `STRIPPED ${silenceIntervals.length} SILENCES -> ${restoredSegments.length} ACTIVE SPEECH CLIPS`
      );
    } else {
      setStatusMessage("NO SILENT INTERVALS DETECTED");
    }
  }, [silenceIntervals, duration, activeSegments, pushUndoSnapshot]);

  // Jump to specific segment and bind it for active In/Out handle trimming
  const handleSelectSegment = useCallback((idx: number, start: number, end: number) => {
    setSelectedClipIndex(idx);
    setInPoint(start);
    setOutPoint(end);
    setCurrentTime(start);
    setStatusMessage(`SELECTED CLIP #${idx + 1}: ${start.toFixed(2)}s -> ${end.toFixed(2)}s`);
  }, []);

  // Double-click timeline to automatically select the clip containing that timestamp
  const handleDoubleClickTimeline = useCallback(
    (time: number) => {
      const idx = activeSegments.findIndex(([s, e]) => time >= s && time <= e);
      if (idx !== -1) {
        const [s, e] = activeSegments[idx];
        handleSelectSegment(idx, s, e);
      }
    },
    [activeSegments, handleSelectSegment]
  );

  // Remove segment from active batch with Undo support
  const handleRemoveSegment = useCallback(
    (indexToRemove: number) => {
      pushUndoSnapshot(activeSegments);
      setActiveSegments((prev) => {
        const next = prev.filter((_, idx) => idx !== indexToRemove);
        if (next.length === 0) {
          setSelectedClipIndex(null);
        } else if (selectedClipIndex !== null && selectedClipIndex >= next.length) {
          setSelectedClipIndex(next.length - 1);
          setInPoint(next[next.length - 1][0]);
          setOutPoint(next[next.length - 1][1]);
        }
        return next;
      });
      setStatusMessage(`REMOVED CLIP #${indexToRemove + 1} (CTRL+Z TO UNDO)`);
    },
    [activeSegments, selectedClipIndex, pushUndoSnapshot]
  );

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

    const defaultOutput = buildExportFilePath(
      filePath,
      customOutputDir,
      "_cut",
      containerFormat
    );

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
  }, [filePath, inPoint, outPoint, duration, customOutputDir, cutMode, containerFormat]);

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
          containerFormat: containerFormat === "auto" ? null : containerFormat,
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
  }, [filePath, activeSegments, customOutputDir, cutMode, containerFormat]);

  // Seamless merge export
  const handleSeamlessMerge = useCallback(async () => {
    if (!filePath || activeSegments.length === 0) return;

    setIsExporting(true);
    setStatusMessage(`SEAMLESS CONCATENATING ${activeSegments.length} ACTIVE SEGMENTS [${cutMode.toUpperCase()}]...`);

    const outputPathOverride = buildExportFilePath(
      filePath,
      customOutputDir,
      "_seamless_clean",
      containerFormat
    );

    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<SeamlessMergeResult>("export_seamless_merge_cmd", {
          sourcePath: filePath,
          segments: activeSegments,
          outputPathOverride,
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
  }, [filePath, activeSegments, customOutputDir, cutMode, containerFormat]);

  // Export NLE Timeline (CMX 3600 EDL + FCPXML v1.9)
  const handleExportNleTimeline = useCallback(async () => {
    if (!filePath) return;
    const segmentsToExport: [number, number][] =
      activeSegments.length > 0
        ? activeSegments
        : [[inPoint ?? 0, outPoint ?? duration]];

    setIsExporting(true);
    setStatusMessage("EXPORTING NLE TIMELINE (CMX 3600 .EDL + FCPXML v1.9 .FCPXML)...");

    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<NleExportResult>("export_nle_timeline_cmd", {
          sourcePath: filePath,
          segments: segmentsToExport,
          totalDuration: duration,
          outputDirOverride: customOutputDir,
        });

        setStatusMessage(
          `NLE TIMELINE EXPORTED (${res.events_count} EVENTS): ${res.edl_path} & ${res.fcpxml_path}`
        );
      } else {
        setStatusMessage("DESKTOP TAURI RUNTIME REQUIRED FOR NLE PROJECT EXPORT");
      }
    } catch (err) {
      setStatusMessage(`NLE EXPORT FAILED: ${err}`);
    } finally {
      setIsExporting(false);
    }
  }, [filePath, activeSegments, inPoint, outPoint, duration, customOutputDir]);

  // Keyboard shortcuts
  useShortcuts({
    togglePlay: () => setIsPlaying((prev) => !prev),
    markIn: () => {
      pushUndoSnapshot(activeSegments);
      handleUpdateInPoint(currentTime);
      if (outPoint !== null && currentTime >= outPoint) {
        handleUpdateOutPoint(Math.min(duration, currentTime + 5.0));
      }
    },
    markOut: () => {
      pushUndoSnapshot(activeSegments);
      handleUpdateOutPoint(currentTime);
      if (inPoint !== null && currentTime <= inPoint) {
        handleUpdateInPoint(Math.max(0, currentTime - 5.0));
      }
    },
    triggerExport: handleExport,
    onNextHighlight: handleNextHighlight,
    stepFrameForward: () => setCurrentTime((t) => Math.min(duration, t + 0.04)),
    stepFrameBackward: () => setCurrentTime((t) => Math.max(0, t - 0.04)),
    seekPrevKeyframe: handleSeekPrevKeyframe,
    seekNextKeyframe: handleSeekNextKeyframe,
    sliceAtPlayhead: handleSliceAtPlayhead,
    toggleSkipSilencePreview: handleToggleSkipSilencePreview,
    cyclePlaybackSpeed: handleCyclePlaybackRate,
    rewindShuttle: () => setCurrentTime((t) => Math.max(0, t - 2.0)),
    zoomIn: () => setZoomLevel((z) => Math.min(16, z * 2)),
    zoomOut: () => setZoomLevel((z) => Math.max(1, z / 2)),
    undo: handleUndo,
    redo: handleRedo,
    openFile: handleOpenMediaDialog,
  });

  const fileNameOnly = filePath ? filePath.split(/[/\\]/).pop() : null;
  const totalKeptSec = activeSegments.reduce(
    (acc, [s, e]) => acc + Math.max(0, e - s),
    0
  );
  const savedSec = Math.max(0, duration - totalKeptSec);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0c0c0e] text-zinc-200 select-none overflow-hidden font-sans antialiased">
      {/* Warning Bar if FFmpeg is missing */}
      {envStatus && !envStatus.ffmpeg_available && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-900 border-b border-white/[0.12] text-zinc-200 text-xs font-mono">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-white" />
            <span>
              FFmpeg binaries not found. Expected in:{" "}
              <strong>{envStatus.internal_bin_dir}</strong>
            </span>
          </div>
          <button
            onClick={() => alert(`Target binary directory: ${envStatus.internal_bin_dir}`)}
            className="flex items-center gap-1 px-2 py-0.5 bg-white text-black rounded text-[10px] font-medium cursor-pointer"
          >
            <FolderOpen className="w-3 h-3" />
            <span>Directory</span>
          </button>
        </div>
      )}

      {/* Top Monochrome Studio Navigation Bar */}
      <header className="h-12 px-4 bg-[#111114] border-b border-white/[0.06] flex items-center justify-between shrink-0">
        {/* Left: Monochrome Logo, Brand, File Switcher & Undo/Redo */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="SnipFlow Logo" className="w-6 h-6 rounded-md" />
            <span className="font-semibold text-sm text-white tracking-tight">
              SnipFlow
            </span>
            <span className="text-[10px] font-mono text-zinc-500 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
              v0.7.0
            </span>
          </div>

          <div className="h-4 w-px bg-white/[0.08]" />

          <button
            onClick={handleOpenMediaDialog}
            className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer"
            title="Open or switch video file (Ctrl+O)"
          >
            <Film className="w-3.5 h-3.5 text-zinc-400" />
            <span className="truncate max-w-[200px]">
              {fileNameOnly || "Open Video..."}
            </span>
            {fileNameOnly && (
              <span className="text-[11px] text-zinc-500">Change</span>
            )}
          </button>

          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5 ml-0.5">
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              aria-label="Undo (Ctrl+Z)"
              title={`Undo (Ctrl+Z) · ${undoStack.length} steps`}
              className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:opacity-30 transition cursor-pointer"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              aria-label="Redo (Ctrl+Y)"
              title={`Redo (Ctrl+Y) · ${redoStack.length} steps`}
              className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:opacity-30 transition cursor-pointer"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Center: Segmented Tri-State Cut Engine Mode Control */}
        <div className="flex items-center p-0.5 rounded-lg bg-[#09090b] border border-white/[0.08] text-xs">
          {(
            [
              {
                id: "smart_copy",
                label: "Smart Cut",
                desc: "Micro-renders partial leading GOP + zero-reencode stream copy body",
              },
              {
                id: "stream_copy",
                label: "Lossless",
                desc: "Instant zero-reencoding (-c copy) snapped to GOP keyframes",
              },
              {
                id: "exact_frame",
                label: "Frame Exact",
                desc: "Full segment ultra-fast re-encode",
              },
            ] as const
          ).map((item) => {
            const active = cutMode === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setCutMode(item.id);
                  setStatusMessage(
                    item.id === "stream_copy"
                      ? "MODE: LOSSLESS STREAM COPY (Instant zero-reencoding, snapped to GOP I-frames)"
                      : item.id === "smart_copy"
                      ? "MODE: SMART CUT (Micro-renders partial leading GOP + zero-reencode stream copy body)"
                      : "MODE: FRAME EXACT (Full segment ultra-fast re-encode)"
                  );
                }}
                title={item.desc}
                className={`px-3 py-1 rounded-md font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer ${
                  active
                    ? "bg-white text-black shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Right: Output Directory, Container Remux Format & Export Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSelectOutputDir}
            aria-label={
              customOutputDir
                ? `Custom export directory: ${customOutputDir}`
                : "Set custom export directory"
            }
            title={
              customOutputDir
                ? `Output Directory: ${customOutputDir}`
                : "Set Custom Export Directory"
            }
            className={`p-1.5 rounded-md border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition cursor-pointer ${
              customOutputDir
                ? "bg-white text-black border-white"
                : "bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.08] text-zinc-300"
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>

          <select
            aria-label="Output container format"
            value={containerFormat}
            onChange={(e) => {
              const fmt = e.target.value as ContainerFormat;
              setContainerFormat(fmt);
              setStatusMessage(
                fmt === "auto"
                  ? "CONTAINER FORMAT: AUTO (Preserve source container)"
                  : `CONTAINER FORMAT: .${fmt.toUpperCase()} (Zero-reencode stream remux)`
              );
            }}
            className="bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 border border-white/[0.08] rounded-md px-2.5 py-1 text-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-white cursor-pointer"
            title="Output Container Format (Original or lossless MP4/MKV/MOV remux)"
          >
            <option value="auto" className="bg-zinc-900">Format: Original</option>
            <option value="mp4" className="bg-zinc-900">Format: MP4</option>
            <option value="mkv" className="bg-zinc-900">Format: MKV</option>
            <option value="mov" className="bg-zinc-900">Format: MOV</option>
          </select>

          <button
            onClick={handleExportNleTimeline}
            disabled={!filePath || isExporting}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:opacity-40 transition cursor-pointer"
            title="Export Non-Destructive NLE Timeline (.edl + .fcpxml) for DaVinci Resolve, Premiere Pro & Final Cut Pro"
          >
            <FileCode className="w-3.5 h-3.5 text-zinc-400" />
            <span>NLE XML</span>
          </button>

          {activeSegments.length > 1 && (
            <>
              <button
                onClick={handleSeamlessMerge}
                disabled={!filePath || isExporting}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.08] hover:bg-white/[0.14] border border-white/20 text-xs text-white font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:opacity-40 transition cursor-pointer"
                title="Remove all silent pauses and merge into a single seamless continuous video"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Merge ({activeSegments.length})</span>
              </button>

              <button
                onClick={handleBatchExport}
                disabled={!filePath || isExporting}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:opacity-40 transition cursor-pointer"
                title="Batch Export All Active Clips as Separate Files"
              >
                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                <span>Batch</span>
              </button>
            </>
          )}

          <button
            onClick={handleExport}
            disabled={!filePath || isExporting}
            className="flex items-center gap-1.5 px-3.5 py-1 rounded-md bg-white hover:bg-zinc-200 text-black font-medium text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40 transition shadow-sm cursor-pointer"
            title="Export Active Selection (Enter)"
          >
            {isExporting ? (
              <>
                <Clock className="w-3.5 h-3.5 animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Export Cut</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Studio Workspace */}
      <main className="flex-1 flex flex-col p-3 gap-3 overflow-hidden min-h-0">
        {!filePath ? (
          <div className="flex-1 flex items-center justify-center p-4">
            <DropZone onFileSelected={handleFileSelected} isLoading={isLoading} />
          </div>
        ) : (
          <>
            {/* Video Preview Monitor */}
            <div className="flex-1 min-h-0 w-full flex items-center justify-center">
              {videoUrl ? (
                <VideoPlayer
                  src={videoUrl}
                  isPlaying={isPlaying}
                  currentTime={currentTime}
                  duration={duration}
                  playbackRate={playbackRate}
                  skipSilencePreview={skipSilencePreview}
                  silenceIntervals={silenceIntervals}
                  onTimeUpdate={setCurrentTime}
                  onTogglePlay={() => setIsPlaying(!isPlaying)}
                  onEnded={() => setIsPlaying(false)}
                  onCyclePlaybackRate={handleCyclePlaybackRate}
                  onToggleSkipSilencePreview={handleToggleSkipSilencePreview}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-[#070709] rounded-xl border border-white/[0.06] font-mono text-xs text-zinc-500">
                  NO VIDEO SIGNAL
                </div>
              )}
            </div>

            {/* Unified Monochrome Timeline & Editing Dock */}
            <div className="rounded-xl bg-[#111115] border border-white/[0.06] flex flex-col overflow-hidden shrink-0">
              {/* Editing & Silence Detection Control Strip */}
              <Toolbar
                inPoint={inPoint}
                outPoint={outPoint}
                currentTime={currentTime}
                keyframes={keyframes}
                isMagneticSnapEnabled={isMagneticSnapEnabled}
                noiseDb={noiseDb}
                minSilenceDuration={minSilenceDuration}
                zoomLevel={zoomLevel}
                isCalibrating={isCalibrating}
                silenceCount={silenceIntervals.length}
                audioTracks={audioTracks}
                selectedTrackIndex={selectedTrackIndex}
                highlightCount={peakHighlights.length}
                totalKeptSec={totalKeptSec}
                savedSec={savedSec}
                onAutoCalibrateNoiseFloor={handleAutoCalibrateNoiseFloor}
                onSelectTrack={handleSelectTrack}
                onToggleMagneticSnap={() => setIsMagneticSnapEnabled(!isMagneticSnapEnabled)}
                onNoiseDbChange={handleNoiseDbChange}
                onMinSilenceDurationChange={handleMinSilenceDurationChange}
                onZoomIn={() => setZoomLevel((z) => Math.min(16, z * 2))}
                onZoomOut={() => setZoomLevel((z) => Math.max(1, z / 2))}
                onMarkIn={() => {
                  pushUndoSnapshot(activeSegments);
                  handleUpdateInPoint(currentTime);
                  if (outPoint !== null && currentTime >= outPoint) {
                    handleUpdateOutPoint(Math.min(duration, currentTime + 5.0));
                  }
                }}
                onMarkOut={() => {
                  pushUndoSnapshot(activeSegments);
                  handleUpdateOutPoint(currentTime);
                  if (inPoint !== null && currentTime <= inPoint) {
                    handleUpdateInPoint(Math.max(0, currentTime - 5.0));
                  }
                }}
                onSliceAtPlayhead={handleSliceAtPlayhead}
                onSnapInToKeyframe={handleSnapInToKeyframe}
                onStripSilence={handleStripSilence}
                onNextHighlight={handleNextHighlight}
                onBuildHighlightReel={handleBuildHighlightReel}
              />

              {/* High-Density 1200-Bin Monochrome Timeline Canvas */}
              <TimelineCanvas
                duration={duration}
                currentTime={currentTime}
                inPoint={inPoint}
                outPoint={outPoint}
                keyframes={keyframes}
                silenceIntervals={silenceIntervals}
                activeSegments={activeSegments}
                selectedClipIndex={selectedClipIndex}
                peakHighlights={peakHighlights}
                waveformPeaks={waveformPeaks}
                isMagneticSnapEnabled={isMagneticSnapEnabled}
                zoomLevel={zoomLevel}
                onSeek={(t) => setCurrentTime(t)}
                onChangeInPoint={handleUpdateInPoint}
                onChangeOutPoint={handleUpdateOutPoint}
                onTrimDragStart={() => pushUndoSnapshot(activeSegments)}
                onWheelZoom={(dir) =>
                  setZoomLevel((z) => (dir === "in" ? Math.min(16, z * 2) : Math.max(1, z / 2)))
                }
                onDoubleClickTime={handleDoubleClickTimeline}
                onDragStart={() => setIsPlaying(false)}
              />

              {/* Active Clips Ribbon */}
              {activeSegments.length > 0 && (
                <div className="h-10 px-3.5 bg-[#111115] border-t border-white/[0.06] flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
                    <span className="text-zinc-500 mr-1 flex items-center gap-1 shrink-0">
                      <Layers className="w-3.5 h-3.5" />
                      <span>Clips ({activeSegments.length})</span>
                    </span>
                    {activeSegments.map(([s, e], idx) => {
                      const clipDur = Math.max(0, e - s);
                      const isCurrent = selectedClipIndex === idx;
                      return (
                        <div
                          key={idx}
                          onClick={() => handleSelectSegment(idx, s, e)}
                          title={`Select Clip #${idx + 1} (${s.toFixed(2)}s - ${e.toFixed(2)}s) for trimming`}
                          className={`flex items-center gap-2 px-2.5 py-1 rounded-md border text-xs transition cursor-pointer shrink-0 ${
                            isCurrent
                              ? "bg-white text-black border-white font-medium"
                              : "bg-white/[0.02] border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05]"
                          }`}
                        >
                          <span>Clip #{idx + 1}</span>
                          <span
                            className={`font-mono text-[11px] tabular-nums ${
                              isCurrent ? "text-zinc-700" : "text-zinc-500"
                            }`}
                          >
                            {clipDur.toFixed(1)}s
                          </span>
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              handleRemoveSegment(idx);
                            }}
                            aria-label={`Remove clip #${idx + 1}`}
                            title="Exclude clip from export (Ctrl+Z to Undo)"
                            className={`transition cursor-pointer ${
                              isCurrent
                                ? "text-zinc-600 hover:text-black"
                                : "text-zinc-500 hover:text-white"
                            }`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {lastExportElapsedMs !== null && (
                    <span className="font-mono text-[11px] text-white bg-white/[0.06] border border-white/[0.12] px-2 py-0.5 rounded shrink-0">
                      Last Export: {lastExportElapsedMs.toFixed(1)}ms
                    </span>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Monochrome Status Footer */}
      <footer className="h-6 px-4 bg-[#09090b] border-t border-white/[0.06] flex items-center justify-between font-mono text-[10px] text-zinc-500 shrink-0">
        <div className="truncate text-zinc-400">
          <span>&gt; {statusMessage}</span>
        </div>

        <div className="flex items-center gap-2.5 text-zinc-500 shrink-0">
          <span>
            <kbd className="px-1 py-0.2 rounded bg-white/[0.05] border border-white/[0.08] text-zinc-300">
              SPACE
            </kbd>{" "}
            Play
          </span>
          <span>
            <kbd className="px-1 py-0.2 rounded bg-white/[0.05] border border-white/[0.08] text-zinc-300">
              J/K/L
            </kbd>{" "}
            Shuttle
          </span>
          <span>
            <kbd className="px-1 py-0.2 rounded bg-white/[0.05] border border-white/[0.08] text-zinc-300">
              S
            </kbd>{" "}
            Skip Silence
          </span>
          <span>
            <kbd className="px-1 py-0.2 rounded bg-white/[0.05] border border-white/[0.08] text-zinc-300">
              X
            </kbd>{" "}
            Split
          </span>
          <span>
            <kbd className="px-1 py-0.2 rounded bg-white/[0.05] border border-white/[0.08] text-zinc-300">
              CTRL+Z/Y
            </kbd>{" "}
            Undo/Redo
          </span>
          <span>
            <kbd className="px-1 py-0.2 rounded bg-white/[0.05] border border-white/[0.08] text-zinc-300">
              CTRL+O
            </kbd>{" "}
            Open
          </span>
          <span>
            <kbd className="px-1 py-0.2 rounded bg-white/[0.05] border border-white/[0.08] text-zinc-300">
              ENTER
            </kbd>{" "}
            Export
          </span>
        </div>
      </footer>
    </div>
  );
};
