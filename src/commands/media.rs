use std::path::PathBuf;
use serde::Serialize;
use tauri::command;
use crate::core::ffmpeg::{find_binary, get_audio_streams, get_internal_bin_dir, AudioStreamInfo};
use crate::core::highlight::detect_peak_highlights;
use crate::{detect_silence_track, get_duration, get_keyframes, invert_silence};

#[derive(Serialize, Clone, Debug)]
pub struct EnvironmentStatus {
    pub ffmpeg_available: bool,
    pub ffprobe_available: bool,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub internal_bin_dir: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct MediaInspection {
    pub path: String,
    pub duration: f64,
    pub keyframes: Vec<f64>,
    pub silence_intervals: Vec<(f64, f64)>,
    pub active_segments: Vec<(f64, f64)>,
    pub audio_tracks: Vec<AudioStreamInfo>,
    pub peak_highlights: Vec<f64>,
}

#[command]
pub fn check_environment_cmd() -> EnvironmentStatus {
    let ffmpeg = find_binary("ffmpeg").ok();
    let ffprobe = find_binary("ffprobe").ok();
    let internal_bin = get_internal_bin_dir();

    EnvironmentStatus {
        ffmpeg_available: ffmpeg.is_some(),
        ffprobe_available: ffprobe.is_some(),
        ffmpeg_path: ffmpeg.map(|p| p.to_string_lossy().to_string()),
        ffprobe_path: ffprobe.map(|p| p.to_string_lossy().to_string()),
        internal_bin_dir: internal_bin.to_string_lossy().to_string(),
    }
}

#[command]
pub async fn inspect_media_cmd(
    file_path: String,
    noise_db: Option<f64>,
    min_silence_duration: Option<f64>,
    track_index: Option<usize>,
) -> Result<MediaInspection, String> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&file_path);
        if !path.exists() {
            return Err(format!("File does not exist: {file_path}"));
        }

        // 1. Probe total media duration
        let duration = get_duration(&path).map_err(|e| e.to_string())?;

        // 2. Extract keyframes without decoding non-keyframes
        let keyframes = get_keyframes(&path).map_err(|e| e.to_string())?;

        // 3. Audio tracks discovery
        let audio_tracks = get_audio_streams(&path).unwrap_or_default();

        // 4. Audio silence detection on chosen track
        let db = noise_db.unwrap_or(-30.0);
        let min_dur = min_silence_duration.unwrap_or(0.5);
        let silence_intervals = detect_silence_track(&path, db, min_dur, track_index).map_err(|e| e.to_string())?;

        // 5. Invert silence intervals to calculate clean active speech segments
        let active_segments = invert_silence(&silence_intervals, duration);

        // 6. Fast peak highlight heuristic (defaults to -14.0 LUFS)
        let peak_highlights = detect_peak_highlights(&path, -14.0).unwrap_or_default();

        Ok(MediaInspection {
            path: file_path,
            duration,
            keyframes,
            silence_intervals,
            active_segments,
            audio_tracks,
            peak_highlights,
        })
    })
    .await
    .map_err(|e| format!("Task execution failed: {e}"))?
}

#[command]
pub async fn rescan_silence_cmd(
    file_path: String,
    noise_db: f64,
    min_silence_duration: f64,
    track_index: Option<usize>,
) -> Result<Vec<(f64, f64)>, String> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&file_path);
        if !path.exists() {
            return Err(format!("File does not exist: {file_path}"));
        }
        detect_silence_track(&path, noise_db, min_silence_duration, track_index).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Silence rescan failed: {e}"))?
}

#[command]
pub async fn scan_peak_highlights_cmd(
    file_path: String,
    threshold_lufs: Option<f64>,
) -> Result<Vec<f64>, String> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&file_path);
        if !path.exists() {
            return Err(format!("File does not exist: {file_path}"));
        }
        detect_peak_highlights(&path, threshold_lufs.unwrap_or(-14.0)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Highlight scan failed: {e}"))?
}
