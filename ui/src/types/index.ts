export interface EnvironmentStatus {
  ffmpeg_available: boolean;
  ffprobe_available: boolean;
  ffmpeg_path: string | null;
  ffprobe_path: string | null;
  internal_bin_dir: string;
}

export interface AudioStreamInfo {
  stream_index: number;
  track_index: number;
  codec: string;
  channels: number;
  title?: string;
}

export interface MediaInspection {
  path: string;
  duration: number;
  keyframes: number[];
  silence_intervals: [number, number][];
  active_segments: [number, number][];
  audio_tracks: AudioStreamInfo[];
  peak_highlights: number[];
  waveform_peaks: number[];
}

export interface CutResult {
  output_path: string;
  elapsed_ms: number;
  start: number;
  end: number;
  duration: number;
}

export interface BatchExportResult {
  exported_count: number;
  total_elapsed_ms: number;
  output_dir: string;
  clips: string[];
}

export interface SeamlessMergeResult {
  output_path: string;
  total_elapsed_ms: number;
  merged_segments_count: number;
}
