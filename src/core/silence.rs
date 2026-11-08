use std::path::Path;
use std::process::Command;
use regex::Regex;
use serde::{Deserialize, Serialize};
use crate::core::ffmpeg::{find_binary, get_audio_streams, get_duration, run_command};
use crate::error::{Result, SnipFlowError};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioVolumeProfile {
    pub mean_volume_db: f64,
    pub max_volume_db: f64,
    pub recommended_silence_db: f64,
}

/// Parses volumedetect logs from FFmpeg stderr to compute audio profile and recommended noise floor.
pub fn parse_volumedetect_output(stderr: &str) -> Result<AudioVolumeProfile> {
    let re_mean = Regex::new(r"mean_volume:\s*(-?[0-9]+(?:\.[0-9]+)?)\s*dB")
        .map_err(|e| SnipFlowError::ParseError(e.to_string()))?;
    let re_max = Regex::new(r"max_volume:\s*(-?[0-9]+(?:\.[0-9]+)?)\s*dB")
        .map_err(|e| SnipFlowError::ParseError(e.to_string()))?;

    let mean_db = re_mean
        .captures(stderr)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .unwrap_or(-35.0);

    let max_db = re_max
        .captures(stderr)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .unwrap_or(-3.0);

    // Adaptive noise floor calibration formula:
    // After 85Hz-7800Hz voice bandpass filtering, continuous AC/fan hum is attenuated.
    // Setting threshold at mean_db - 6.5dB reliably catches pauses without cutting off quiet syllables.
    let rec_db = (mean_db - 6.5).clamp(-50.0, -18.0);
    let rounded_rec = (rec_db * 10.0).round() / 10.0;

    Ok(AudioVolumeProfile {
        mean_volume_db: (mean_db * 10.0).round() / 10.0,
        max_volume_db: (max_db * 10.0).round() / 10.0,
        recommended_silence_db: rounded_rec,
    })
}

/// Analyzes vocal band volume distribution using 85Hz-7800Hz bandpass + volumedetect filter.
pub fn probe_audio_volume(
    video_path: &Path,
    track_index: Option<usize>,
) -> Result<AudioVolumeProfile> {
    if !video_path.exists() {
        return Err(SnipFlowError::FileNotFound(video_path.to_path_buf()));
    }

    let tracks = get_audio_streams(video_path)?;
    if tracks.is_empty() {
        return Ok(AudioVolumeProfile {
            mean_volume_db: -90.0,
            max_volume_db: -90.0,
            recommended_silence_db: -30.0,
        });
    }

    let ffmpeg_path = find_binary("ffmpeg")?;
    let mut cmd = Command::new(ffmpeg_path);
    let map_arg = format!("0:a:{}", track_index.unwrap_or(0));

    cmd.args([
        "-nostats",
        "-hide_banner",
        "-vn",
        "-i",
    ]);
    cmd.arg(video_path);
    cmd.args([
        "-map",
        &map_arg,
        "-af",
        "highpass=f=85,lowpass=f=7800,volumedetect",
        "-f",
        "null",
        "-",
    ]);

    let output = run_command(&mut cmd, "ffmpeg volumedetect probe")?;
    let stderr = String::from_utf8_lossy(&output.stderr);

    parse_volumedetect_output(&stderr)
}

/// Detects dead-air / silent intervals in an audio/video asset on a specific audio track.
/// Applies an 85Hz-7800Hz vocal bandpass filter during detection to reject low-frequency HVAC/fan
/// rumble and high-frequency coil whine without altering the exported audio stream.
pub fn detect_silence_track(
    video_path: &Path,
    noise_db: f64,
    min_duration: f64,
    track_index: Option<usize>,
) -> Result<Vec<(f64, f64)>> {
    if !video_path.exists() {
        return Err(SnipFlowError::FileNotFound(video_path.to_path_buf()));
    }

    // Safety guard: if container has no audio streams, exit safely without crashing FFmpeg
    let tracks = get_audio_streams(video_path)?;
    if tracks.is_empty() {
        return Ok(Vec::new());
    }

    if min_duration <= 0.0 {
        return Err(SnipFlowError::InvalidTimeRange {
            start: 0.0,
            end: min_duration,
        });
    }

    let normalized_db = if noise_db > 0.0 { -noise_db } else { noise_db };
    let ffmpeg_path = find_binary("ffmpeg")?;
    let mut cmd = Command::new(ffmpeg_path);

    let filter_arg = format!(
        "highpass=f=85,lowpass=f=7800,silencedetect=noise={}dB:d={}",
        normalized_db, min_duration
    );

    // Bypass video processing (-vn)
    cmd.args([
        "-nostats",
        "-hide_banner",
        "-vn",
        "-i",
    ]);
    cmd.arg(video_path);

    let map_arg = format!("0:a:{}", track_index.unwrap_or(0));
    cmd.args([
        "-map",
        &map_arg,
        "-af",
        &filter_arg,
        "-f",
        "null",
        "-",
    ]);

    let output = run_command(&mut cmd, "ffmpeg detect silence")?;
    let stderr = String::from_utf8_lossy(&output.stderr);

    let total_duration = get_duration(video_path).ok();
    parse_silencedetect_logs(&stderr, total_duration)
}

/// Detects dead-air / silent intervals on default primary audio track.
pub fn detect_silence(
    video_path: &Path,
    noise_db: f64,
    min_duration: f64,
) -> Result<Vec<(f64, f64)>> {
    detect_silence_track(video_path, noise_db, min_duration, None)
}

/// Parses silencedetect logs from FFmpeg stderr and pairs intervals.
pub fn parse_silencedetect_logs(
    stderr: &str,
    fallback_duration: Option<f64>,
) -> Result<Vec<(f64, f64)>> {
    let re_start = Regex::new(r"silence_start:\s*([0-9]+(?:\.[0-9]+)?)")
        .map_err(|e| SnipFlowError::ParseError(e.to_string()))?;
    let re_end = Regex::new(r"silence_end:\s*([0-9]+(?:\.[0-9]+)?)")
        .map_err(|e| SnipFlowError::ParseError(e.to_string()))?;

    let mut intervals = Vec::new();
    let mut pending_start: Option<f64> = None;

    for line in stderr.lines() {
        if let Some(caps) = re_start.captures(line) {
            if let Some(m) = caps.get(1) {
                if let Ok(val) = m.as_str().parse::<f64>() {
                    pending_start = Some(val);
                }
            }
        } else if let Some(caps) = re_end.captures(line) {
            if let Some(m) = caps.get(1) {
                if let Ok(end_val) = m.as_str().parse::<f64>() {
                    if let Some(start_val) = pending_start.take() {
                        if end_val > start_val {
                            intervals.push((start_val, end_val));
                        }
                    }
                }
            }
        }
    }

    // If media concludes with ongoing silence, cap interval to video duration
    if let Some(start_val) = pending_start {
        if let Some(total_duration) = fallback_duration {
            if total_duration > start_val {
                intervals.push((start_val, total_duration));
            }
        }
    }

    Ok(intervals)
}
