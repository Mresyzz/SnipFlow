use std::path::Path;
use std::process::Command;
use regex::Regex;
use crate::core::ffmpeg::{find_binary, get_duration, run_command};
use crate::error::{Result, SnipFlowError};

/// Detects dead-air / silent intervals in an audio/video asset on a specific audio track.
pub fn detect_silence_track(
    video_path: &Path,
    noise_db: f64,
    min_duration: f64,
    track_index: Option<usize>,
) -> Result<Vec<(f64, f64)>> {
    if !video_path.exists() {
        return Err(SnipFlowError::FileNotFound(video_path.to_path_buf()));
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

    let filter_arg = format!("silencedetect=noise={}dB:d={}", normalized_db, min_duration);

    // Bypass video processing (-vn)
    cmd.args([
        "-nostats",
        "-hide_banner",
        "-vn",
        "-i",
    ]);
    cmd.arg(video_path);

    // Map specific audio track if provided (e.g. 0:a:1 for secondary mic track)
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

    parse_silencedetect_output(&stderr, video_path)
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
fn parse_silencedetect_output(stderr: &str, video_path: &Path) -> Result<Vec<(f64, f64)>> {
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
        if let Ok(total_duration) = get_duration(video_path) {
            if total_duration > start_val {
                intervals.push((start_val, total_duration));
            }
        }
    }

    Ok(intervals)
}
