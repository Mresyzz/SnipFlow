export interface EnvironmentStatus {
  ffmpeg_available: boolean;
  ffprobe_available: boolean;
  ffmpeg_path: string | null;
  ffprobe_path: string | null;
}

export interface MediaInspection {
  path: string;
  duration: number;
  keyframes: number[];
  silence_intervals: [number, number][];
  active_segments: [number, number][];
}

export interface CutResult {
  output_path: string;
  elapsed_ms: number;
  start: number;
  end: number;
  duration: number;
}
