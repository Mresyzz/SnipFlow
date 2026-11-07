export interface MediaInspection {
  path: string;
  duration: f64;
  keyframes: number[];
  silence_intervals: [number, number][];
  active_segments: [number, number][];
}

type f64 = number;

export interface CutResult {
  output_path: string;
  elapsed_ms: number;
  start: number;
  end: number;
  duration: number;
}
