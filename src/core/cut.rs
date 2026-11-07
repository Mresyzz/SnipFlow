use std::path::Path;
use std::process::Command;
use serde::{Deserialize, Serialize};
use crate::core::ffmpeg::{find_binary, run_command};
use crate::error::{Result, SnipFlowError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CutMode {
    #[serde(rename = "stream_copy")]
    StreamCopy,
    #[serde(rename = "exact_frame")]
    ExactFrame,
}

impl Default for CutMode {
    fn default() -> Self {
        Self::StreamCopy
    }
}

/// Executes a media stream cut with either zero-reencode stream copy or frame-accurate fast encode.
pub fn lossless_cut_with_mode(
    video_path: &Path,
    start: f64,
    end: f64,
    output_path: &Path,
    mode: CutMode,
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

    let start_str = format!("{:.3}", start);
    let duration_str = format!("{:.3}", end - start);

    match mode {
        CutMode::StreamCopy => {
            // Instant demux/remux zero-reencode pass
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
                "-fflags", "+genpts",
            ]);
            cmd.arg(output_path);
        }
        CutMode::ExactFrame => {
            // Frame-exact ultra-fast render fallback for sub-frame boundaries
            cmd.args([
                "-y",
                "-ss", &start_str,
                "-i",
            ]);
            cmd.arg(video_path);
            cmd.args([
                "-t", &duration_str,
                "-map", "0",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-crf", "18",
                "-c:a", "copy",
                "-c:s", "copy",
                "-avoid_negative_ts", "make_zero",
            ]);
            cmd.arg(output_path);
        }
    }

    run_command(&mut cmd, "ffmpeg media cut")?;
    Ok(())
}

/// Executes an instantaneous, zero-reencode lossless stream export.
pub fn lossless_cut(
    video_path: &Path,
    start: f64,
    end: f64,
    output_path: &Path,
) -> Result<()> {
    lossless_cut_with_mode(video_path, start, end, output_path, CutMode::StreamCopy)
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

/// Merges multiple time intervals from source media into a single continuous file with specified cut mode.
pub fn seamless_merge_with_mode(
    video_path: &Path,
    segments: &[(f64, f64)],
    output_path: &Path,
    mode: CutMode,
) -> Result<()> {
    if !video_path.exists() {
        return Err(SnipFlowError::FileNotFound(video_path.to_path_buf()));
    }

    if segments.is_empty() {
        return Err(SnipFlowError::InvalidTimeRange { start: 0.0, end: 0.0 });
    }

    if segments.len() == 1 {
        let (s, e) = segments[0];
        return lossless_cut_with_mode(video_path, s, e, output_path, mode);
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
        lossless_cut_with_mode(video_path, s, e, &clip_path, mode)?;
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

/// Merges multiple time intervals from source media into a single continuous file with zero re-encoding.
pub fn seamless_merge(
    video_path: &Path,
    segments: &[(f64, f64)],
    output_path: &Path,
) -> Result<()> {
    seamless_merge_with_mode(video_path, segments, output_path, CutMode::StreamCopy)
}
