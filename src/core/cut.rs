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

/// Merges multiple time intervals from source media into a single continuous file with zero re-encoding.
pub fn seamless_merge(
    video_path: &Path,
    segments: &[(f64, f64)],
    output_path: &Path,
) -> Result<()> {
    if !video_path.exists() {
        return Err(SnipFlowError::FileNotFound(video_path.to_path_buf()));
    }

    if segments.is_empty() {
        return Err(SnipFlowError::InvalidTimeRange { start: 0.0, end: 0.0 });
    }

    if segments.len() == 1 {
        let (s, e) = segments[0];
        return lossless_cut(video_path, s, e, output_path);
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let tmp_dir = std::env::temp_dir().join(format!("snipflow_concat_{timestamp}"));
    std::fs::create_dir_all(&tmp_dir)?;

    let extension = video_path.extension().unwrap_or_default().to_string_lossy();
    let ext_str = if extension.is_empty() { "mp4" } else { &extension };

    let mut tmp_clips = Vec::new();
    let mut concat_entries = Vec::new();

    for (idx, &(s, e)) in segments.iter().enumerate() {
        if e <= s {
            continue;
        }
        let clip_file_name = format!("chunk_{:03}.{}", idx, ext_str);
        let clip_path = tmp_dir.join(&clip_file_name);
        lossless_cut(video_path, s, e, &clip_path)?;
        tmp_clips.push(clip_path);
        // Use relative filename to avoid path separator escaping issues
        concat_entries.push(format!("file '{clip_file_name}'"));
    }

    if tmp_clips.is_empty() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(SnipFlowError::InvalidTimeRange { start: 0.0, end: 0.0 });
    }

    let concat_list_path = tmp_dir.join("concat_list.txt");
    std::fs::write(&concat_list_path, concat_entries.join("\n"))?;

    let ffmpeg_path = find_binary("ffmpeg")?;
    let mut cmd = Command::new(ffmpeg_path);

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    cmd.current_dir(&tmp_dir);
    cmd.args([
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i",
    ]);
    cmd.arg("concat_list.txt");
    cmd.args([
        "-c", "copy",
        "-movflags", "+faststart",
    ]);
    cmd.arg(output_path);

    let res = run_command(&mut cmd, "ffmpeg seamless concat");

    let _ = std::fs::remove_dir_all(&tmp_dir);

    res?;
    Ok(())
}
