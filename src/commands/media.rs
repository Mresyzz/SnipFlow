use std::path::PathBuf;
use serde::Serialize;
use tauri::command;
use crate::{detect_silence, get_duration, get_keyframes, invert_silence};

#[derive(Serialize, Clone, Debug)]
pub struct MediaInspection {
    pub path: String,
    pub duration: f64,
    pub keyframes: Vec<f64>,
    pub silence_intervals: Vec<(f64, f64)>,
    pub active_segments: Vec<(f64, f64)>,
}

#[command]
pub async fn inspect_media_cmd(
    file_path: String,
    noise_db: Option<f64>,
    min_silence_duration: Option<f64>,
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

        // 3. Audio silence detection
        let db = noise_db.unwrap_or(-30.0);
        let min_dur = min_silence_duration.unwrap_or(0.5);
        let silence_intervals = detect_silence(&path, db, min_dur).map_err(|e| e.to_string())?;

        // 4. Invert silence intervals to calculate clean active speech segments
        let active_segments = invert_silence(&silence_intervals, duration);

        Ok(MediaInspection {
            path: file_path,
            duration,
            keyframes,
            silence_intervals,
            active_segments,
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
) -> Result<Vec<(f64, f64)>, String> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&file_path);
        if !path.exists() {
            return Err(format!("File does not exist: {file_path}"));
        }
        detect_silence(&path, noise_db, min_silence_duration).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Silence rescan failed: {e}"))?
}
