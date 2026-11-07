use std::path::Path;
use std::process::Command;
use serde::{Deserialize, Serialize};
use crate::core::ffmpeg::{find_binary, run_command};
use crate::error::{Result, SnipFlowError};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KeyframeAlignment {
    pub target_sec: f64,
    pub nearest_pts: f64,
    pub diff_ms: f64,
    pub is_aligned: bool,
}

/// Finds the nearest keyframe PTS using binary search on a sorted keyframe slice.
pub fn find_nearest_keyframe(keyframes: &[f64], target_sec: f64) -> Option<f64> {
    if keyframes.is_empty() {
        return None;
    }

    match keyframes.binary_search_by(|k| k.partial_cmp(&target_sec).unwrap_or(std::cmp::Ordering::Equal)) {
        Ok(idx) => Some(keyframes[idx]),
        Err(idx) => {
            if idx == 0 {
                Some(keyframes[0])
            } else if idx >= keyframes.len() {
                Some(keyframes[keyframes.len() - 1])
            } else {
                let prev = keyframes[idx - 1];
                let next = keyframes[idx];
                if (target_sec - prev).abs() <= (next - target_sec).abs() {
                    Some(prev)
                } else {
                    Some(next)
                }
            }
        }
    }
}

/// Checks keyframe alignment for a proposed cut timestamp and reports drift in milliseconds.
pub fn check_keyframe_alignment(keyframes: &[f64], target_sec: f64) -> Option<KeyframeAlignment> {
    let nearest = find_nearest_keyframe(keyframes, target_sec)?;
    let diff_ms = (target_sec - nearest) * 1000.0;
    // Considered aligned if within 1 frame boundary (approx 18ms for 60fps)
    let is_aligned = diff_ms.abs() < 18.0;

    Some(KeyframeAlignment {
        target_sec,
        nearest_pts: nearest,
        diff_ms: (diff_ms * 10.0).round() / 10.0,
        is_aligned,
    })
}

/// Extracts all I-frame (keyframe) presentation timestamps (PTS) in seconds.
///
/// Executes an ultra-fast demux scan with `-skip_frame nokey`, bypassing non-keyframe
/// decoding entirely to scan hours of 4K footage in milliseconds.
pub fn get_keyframes(video_path: &Path) -> Result<Vec<f64>> {
    if !video_path.exists() {
        return Err(SnipFlowError::FileNotFound(video_path.to_path_buf()));
    }

    let ffprobe_path = find_binary("ffprobe")?;
    let mut cmd = Command::new(ffprobe_path);

    // Fast packet PTS extraction for keyframes only
    cmd.args([
        "-v", "error",
        "-select_streams", "v:0",
        "-skip_frame", "nokey",
        "-show_entries", "frame=pkt_pts_time",
        "-of", "csv=p=0",
    ]);
    cmd.arg(video_path);

    let output = run_command(&mut cmd, "ffprobe extract keyframes")?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut timestamps: Vec<f64> = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("n/a") {
            continue;
        }

        match trimmed.parse::<f64>() {
            Ok(ts) if ts >= 0.0 => timestamps.push(ts),
            _ => continue, // Ignore parsing glitches on corrupt stream packets
        }
    }

    // Ensure sorted and unique timestamps
    timestamps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    timestamps.dedup_by(|a, b| (*a - *b).abs() < 1e-4);

    Ok(timestamps)
}
