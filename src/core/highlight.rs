use std::path::Path;
use std::process::Command;
use regex::Regex;
use crate::core::ffmpeg::{find_binary, run_command};
use crate::error::{Result, SnipFlowError};

/// Scans the audio track for sudden transient loudness peaks (gaming kills, screams, loud highlights).
///
/// Returns a list of peak presentation timestamps (PTS) in seconds.
///
/// # Arguments
/// * `video_path` - Path to the video file
/// * `peak_threshold_lufs` - Momentary loudness threshold in LUFS (e.g. `-14.0` or `-12.0`)
pub fn detect_peak_highlights(
    video_path: &Path,
    peak_threshold_lufs: f64,
) -> Result<Vec<f64>> {
    if !video_path.exists() {
        return Err(SnipFlowError::FileNotFound(video_path.to_path_buf()));
    }

    let ffmpeg_path = find_binary("ffmpeg")?;
    let mut cmd = Command::new(ffmpeg_path);

    // Bypasses video processing completely (-vn) and analyzes momentary loudness using EBU R128
    cmd.args([
        "-nostats",
        "-hide_banner",
        "-vn",
        "-i",
    ]);
    cmd.arg(video_path);
    cmd.args([
        "-af",
        "ebur128=metadata=1",
        "-f",
        "null",
        "-",
    ]);

    let output = run_command(&mut cmd, "ffmpeg detect peak highlights")?;
    let stderr = String::from_utf8_lossy(&output.stderr);

    parse_ebur128_peaks(&stderr, peak_threshold_lufs)
}

/// Parses EBU R128 momentary loudness records from FFmpeg output
fn parse_ebur128_peaks(stderr: &str, threshold_lufs: f64) -> Result<Vec<f64>> {
    let re_record = Regex::new(r"t:\s*([0-9.]+)\s+TARGET:.*M:\s*([-\w.]+)")
        .map_err(|e| SnipFlowError::ParseError(e.to_string()))?;

    let mut peaks = Vec::new();
    let mut last_peak_time: f64 = -10.0;

    for line in stderr.lines() {
        if let Some(caps) = re_record.captures(line) {
            let t_str = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let m_str = caps.get(2).map(|m| m.as_str()).unwrap_or("");

            if let (Ok(t), Ok(m)) = (t_str.parse::<f64>(), m_str.parse::<f64>()) {
                // If momentary loudness exceeds threshold and is separated by at least 3 seconds from previous peak
                if m >= threshold_lufs && (t - last_peak_time) > 3.0 {
                    peaks.push(t);
                    last_peak_time = t;
                }
            }
        }
    }

    Ok(peaks)
}
