use std::path::Path;
use std::process::Command;
use crate::core::ffmpeg::{find_binary, run_command};
use crate::error::{Result, SnipFlowError};

/// Executes an instantaneous, zero-reencode lossless stream export.
///
/// # Arguments
/// * `video_path` - Source video file path
/// * `start` - Start timestamp in seconds
/// * `end` - End timestamp in seconds
/// * `output_path` - Target export destination path
pub fn lossless_cut(
    video_path: &Path,
    start: f64,
    end: f64,
    output_path: &Path,
) -> Result<()> {
    if !video_path.exists() {
        return Err(SnipFlowError::FileNotFound(video_path.to_path_buf()));
    }

    if start < 0.0 || end <= start {
        return Err(SnipFlowError::InvalidTimeRange { start, end });
    }

    // Ensure parent directory exists for destination
    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let ffmpeg_path = find_binary("ffmpeg")?;
    let mut cmd = Command::new(ffmpeg_path);

    // Format timestamps with millisecond precision
    let start_str = format!("{:.3}", start);
    let duration_str = format!("{:.3}", end - start);

    // Fast-seek (-ss before -i) with duration limit (-t) + stream copy (-c copy) + zero-timestamp reset
    cmd.args([
        "-y",
        "-ss", &start_str,
        "-t", &duration_str,
        "-i",
    ]);
    cmd.arg(video_path);
    cmd.args([
        "-c", "copy",
        "-map", "0",
        "-avoid_negative_ts", "make_zero",
    ]);
    cmd.arg(output_path);

    run_command(&mut cmd, "ffmpeg lossless cut")?;
    Ok(())
}

/// Helper function: Computes active speech spans by inverting silence intervals over total duration.
pub fn invert_silence(silence_intervals: &[(f64, f64)], total_duration: f64) -> Vec<(f64, f64)> {
    let mut active = Vec::new();
    let mut current_pos = 0.0;

    for &(silence_start, silence_end) in silence_intervals {
        if silence_start > current_pos {
            active.push((current_pos, silence_start));
        }
        current_pos = current_pos.max(silence_end);
    }

    if current_pos < total_duration {
        active.push((current_pos, total_duration));
    }

    active
}
