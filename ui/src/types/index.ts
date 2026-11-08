export type CutMode = 'stream_copy' | 'smart_copy' | 'exact_frame';
export type ContainerFormat = 'auto' | 'mp4' | 'mkv' | 'mov';

export interface EnvironmentStatus {
  ffmpeg_available: boolean;
  ffprobe_available: boolean;
  ffmpeg_path: string | null;
  ffprobe_path: string | null;
  internal_bin_dir: string;
  install_hint?: string | null;
}

export interface AudioStreamInfo {
  stream_index: number;
  track_index: number;
  codec: string;
  channels: number;
  title?: string;
}

export interface AudioVolumeProfile {
  mean_volume_db: number;
  max_volume_db: number;
  recommended_silence_db: number;
}

export interface KeyframeAlignment {
  target_sec: number;
  nearest_pts: number;
  diff_ms: number;
  is_aligned: boolean;
}

export interface MediaContainerValidation {
  is_valid: boolean;
  format_name: string;
  duration: number;
  has_video: boolean;
  has_audio: boolean;
  video_codec?: string;
  audio_codec?: string;
  width?: number;
  height?: number;
  error_message?: string;
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
  validation?: MediaContainerValidation;
}

export interface CutResult {
  output_path: string;
  elapsed_ms: number;
  start: number;
  end: number;
  duration: number;
  mode?: CutMode;
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

export interface NleExportResult {
  edl_path: string;
  fcpxml_path: string;
  events_count: number;
}
