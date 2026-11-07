use std::path::PathBuf;
use serde::Serialize;
use tauri::command;
use snipflow::{
    check_keyframe_alignment, detect_peak_highlights, detect_silence_track, find_binary,
    find_nearest_keyframe, generate_waveform_peaks, get_audio_streams, get_duration,
    get_internal_bin_dir, get_keyframes, invert_silence, probe_audio_volume, validate_media_file,
    AudioStreamInfo, AudioVolumeProfile, KeyframeAlignment, MediaContainerValidation,
};

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
    pub waveform_peaks: Vec<f32>,
    pub validation: MediaContainerValidation,
}

#[command]
pub async fn select_video_file_cmd() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        let file = rfd::FileDialog::new()
            .add_filter("Video Files", &["mp4", "mkv", "mov", "webm", "avi", "flv", "ts"])
            .set_title("Select Raw Video for Lossless Cut")
            .pick_file();

        Ok(file.map(|p| p.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| format!("Native dialog error: {e}"))?
}

#[command]
pub async fn select_output_directory_cmd() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        let dir = rfd::FileDialog::new()
            .set_title("Select Export Destination Directory")
            .pick_folder();

        Ok(dir.map(|p| p.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| format!("Native dialog error: {e}"))?
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
pub async fn validate_media_container_cmd(file_path: String) -> Result<MediaContainerValidation, String> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&file_path);
        validate_media_file(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Validation task failed: {e}"))?
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

        // 1. Preflight container validation
        let validation = validate_media_file(&path).map_err(|e| e.to_string())?;
        if !validation.is_valid {
            return Err(validation.error_message.unwrap_or_else(|| "Invalid media container".to_string()));
        }

        // 2. Probe total media duration
        let duration = if validation.duration > 0.0 {
            validation.duration
        } else {
            get_duration(&path).map_err(|e| e.to_string())?
        };

        // 3. Extract keyframes without decoding non-keyframes
        let keyframes = get_keyframes(&path).unwrap_or_default();

        // 4. Audio tracks discovery
        let audio_tracks = get_audio_streams(&path).unwrap_or_default();

        // 5. Audio silence detection, peak highlights and waveform peaks with silent video guard
        let (silence_intervals, peak_highlights, waveform_peaks) = if !audio_tracks.is_empty() {
            let db = noise_db.unwrap_or(-30.0);
            let min_dur = min_silence_duration.unwrap_or(0.5);
            let silences = detect_silence_track(&path, db, min_dur, track_index).unwrap_or_default();
            let peaks = detect_peak_highlights(&path, -14.0).unwrap_or_default();
            let waves = generate_waveform_peaks(&path, 300, track_index).unwrap_or_default();
            (silences, peaks, waves)
        } else {
            (Vec::new(), Vec::new(), Vec::new())
        };

        // 6. Invert silence intervals to calculate clean active speech segments
        let active_segments = if !silence_intervals.is_empty() {
            invert_silence(&silence_intervals, duration)
        } else {
            vec![(0.0, duration)]
        };

        Ok(MediaInspection {
            path: file_path,
            duration,
            keyframes,
            silence_intervals,
            active_segments,
            audio_tracks,
            peak_highlights,
            waveform_peaks,
            validation,
        })
    })
    .await
    .map_err(|e| format!("Task execution failed: {e}"))?
}

#[command]
pub async fn calibrate_silence_threshold_cmd(
    file_path: String,
    track_index: Option<usize>,
) -> Result<AudioVolumeProfile, String> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&file_path);
        probe_audio_volume(&path, track_index).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Audio calibration failed: {e}"))?
}

#[command]
pub fn check_keyframe_alignment_cmd(
    keyframes: Vec<f64>,
    target_sec: f64,
) -> Option<KeyframeAlignment> {
    check_keyframe_alignment(&keyframes, target_sec)
}

#[command]
pub fn find_nearest_keyframe_cmd(
    keyframes: Vec<f64>,
    target_sec: f64,
) -> Option<f64> {
    find_nearest_keyframe(&keyframes, target_sec)
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
        let audio_tracks = get_audio_streams(&path).unwrap_or_default();
        if audio_tracks.is_empty() {
            return Ok(Vec::new());
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
        let audio_tracks = get_audio_streams(&path).unwrap_or_default();
        if audio_tracks.is_empty() {
            return Ok(Vec::new());
        }
        detect_peak_highlights(&path, threshold_lufs.unwrap_or(-14.0)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Highlight scan failed: {e}"))?
}
