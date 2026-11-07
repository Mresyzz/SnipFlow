use std::path::Path;
use std::process::Command;
use crate::core::ffmpeg::{find_binary, run_command};
use crate::error::{Result, SnipFlowError};

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
