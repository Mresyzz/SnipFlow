use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use crate::core::ffmpeg::{find_binary, run_command};
use crate::core::keyframe::get_keyframes;
use crate::error::{Result, SnipFlowError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CutMode {
    #[serde(rename = "stream_copy")]
    StreamCopy,
    #[serde(rename = "smart_copy")]
    SmartCopy,
    #[serde(rename = "exact_frame")]
    ExactFrame,
}

impl Default for CutMode {
    fn default() -> Self {
        Self::StreamCopy
    }
}

/// Checks if output path points to the exact same file as input path to prevent source truncation.
fn ensure_distinct_paths(video_path: &Path, output_path: &Path) -> Result<()> {
    if video_path == output_path {
        return Err(SnipFlowError::ParseError(
            "Output path cannot be identical to source media path".to_string(),
        ));
    }
    if let (Ok(canon_src), Ok(canon_dst)) = (video_path.canonicalize(), output_path.canonicalize()) {
        if canon_src == canon_dst {
            return Err(SnipFlowError::ParseError(
                "Output path resolves to the same file as source media path".to_string(),
            ));
        }
    }
    Ok(())
}

/// Resolves a potentially relative path against the process current working directory.
fn resolve_abs_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

/// Checks whether the target container extension belongs to the MP4/MOV family supporting `+faststart`.
fn is_mp4_family_container(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| matches!(s.to_ascii_lowercase().as_str(), "mp4" | "mov" | "m4v"))
        .unwrap_or(true)
}

/// Finds the first keyframe strictly after `start_sec` (beyond 1 frame margin) and before `end_sec`.
pub fn find_next_gop_boundary(keyframes: &[f64], start_sec: f64, end_sec: f64) -> Option<f64> {
    let min_head = start_sec + 0.025;
    let max_head = end_sec - 0.100;
    if min_head >= max_head {
        return None;
    }

    keyframes
        .iter()
        .copied()
        .find(|&kf| kf >= min_head && kf <= max_head)
}

/// Executes a single-pass stream copy or exact re-encode segment export with timestamp sanitization.
fn execute_single_cut(
    video_path: &Path,
    start: f64,
    end: f64,
    output_path: &Path,
    exact_reencode: bool,
) -> Result<()> {
    let ffmpeg_path = find_binary("ffmpeg")?;
    let mut cmd = Command::new(ffmpeg_path);

    let start_str = format!("{:.3}", start);
    let duration_str = format!("{:.3}", end - start);
    let is_mp4_family = is_mp4_family_container(output_path);

    if !exact_reencode {
        // Resilient zero-reencode stream copy with PTS regeneration and multi-track preservation
        cmd.args([
            "-y",
            "-fflags", "+genpts+igndts+discardcorrupt",
            "-ss", &start_str,
            "-t", &duration_str,
            "-i",
        ]);
        cmd.arg(video_path);
        cmd.args([
            "-map", "0:v:0?",
            "-map", "0:a?",
            "-map", "0:s?",
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            "-max_interleave_delta", "0",
        ]);
        if is_mp4_family {
            cmd.args(["-movflags", "+faststart"]);
        }
        cmd.arg(output_path);
    } else {
        // Frame-exact ultra-fast encode for sub-GOP precision
        cmd.args([
            "-y",
            "-fflags", "+genpts+igndts+discardcorrupt",
            "-ss", &start_str,
            "-i",
        ]);
        cmd.arg(video_path);
        cmd.args([
            "-t", &duration_str,
            "-map", "0:v:0?",
            "-map", "0:a?",
            "-map", "0:s?",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            "-c:s", "copy",
            "-avoid_negative_ts", "make_zero",
        ]);
        if is_mp4_family {
            cmd.args(["-movflags", "+faststart"]);
        }
        cmd.arg(output_path);
    }

    run_command(&mut cmd, "ffmpeg media cut")?;
    Ok(())
}

/// Executes GOP micro-smart-rendering using a pre-extracted keyframe slice.
/// Re-encodes only the partial leading GOP up to the first I-frame, then performs
/// a zero-reencode stream copy for the remaining body.
fn execute_hybrid_smart_cut_with_keyframes(
    video_path: &Path,
    start: f64,
    end: f64,
    output_path: &Path,
    keyframes: &[f64],
) -> Result<()> {
    // Check if `start` is already aligned to a keyframe within 18ms
    let is_start_aligned = keyframes.iter().any(|&kf| (kf - start).abs() < 0.018);
    if is_start_aligned {
        return execute_single_cut(video_path, start, end, output_path, false);
    }

    // Find next keyframe boundary inside [start, end]
    let Some(next_kf) = find_next_gop_boundary(keyframes, start, end) else {
        // Entire clip falls within a single GOP; fallback to fast exact encode
        return execute_single_cut(video_path, start, end, output_path, true);
    };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_dir = std::env::temp_dir().join(format!("snipflow_smartgop_{timestamp}"));
    std::fs::create_dir_all(&tmp_dir)?;

    let extension = output_path.extension().unwrap_or_default().to_string_lossy();
    let ext_str = if extension.is_empty() { "mp4" } else { &extension };

    let head_name = format!("gop_head.{ext_str}");
    let body_name = format!("gop_body.{ext_str}");
    let head_path = tmp_dir.join(&head_name);
    let body_path = tmp_dir.join(&body_name);
    let concat_list_path = tmp_dir.join("concat_list.txt");
    let abs_output_path = resolve_abs_path(output_path);
    let is_mp4_family = is_mp4_family_container(&abs_output_path);

    let step_result = (|| -> Result<()> {
        // 1. Micro-render the partial leading GOP [start -> next_kf]
        execute_single_cut(video_path, start, next_kf, &head_path, true)?;

        // 2. Zero-reencode stream copy the remaining body [next_kf -> end]
        execute_single_cut(video_path, next_kf, end, &body_path, false)?;

        // 3. Stitch head and body via concat demuxer (paths resolved relative to concat_list.txt dir)
        let concat_list = format!("file '{head_name}'\nfile '{body_name}'\n");
        std::fs::write(&concat_list_path, concat_list)?;

        let ffmpeg_path = find_binary("ffmpeg")?;
        let mut cmd = Command::new(ffmpeg_path);
        cmd.args([
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i",
        ]);
        cmd.arg(&concat_list_path);
        cmd.args([
            "-map", "0:v:0?",
            "-map", "0:a?",
            "-map", "0:s?",
            "-c", "copy",
        ]);
        if is_mp4_family {
            cmd.args(["-movflags", "+faststart"]);
        }
        cmd.arg(&abs_output_path);

        run_command(&mut cmd, "ffmpeg smart-gop concat")?;
        Ok(())
    })();

    let _ = std::fs::remove_dir_all(&tmp_dir);

    // If hybrid stitch fails due to incompatible codec parameters in container, fallback to ExactFrame
    if step_result.is_err() {
        return execute_single_cut(video_path, start, end, &abs_output_path, true);
    }

    Ok(())
}

/// Executes a media stream cut with StreamCopy, SmartCopy (GOP micro-render), or ExactFrame.
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

    ensure_distinct_paths(video_path, output_path)?;

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    match mode {
        CutMode::StreamCopy => execute_single_cut(video_path, start, end, output_path, false),
        CutMode::SmartCopy => {
            let keyframes = get_keyframes(video_path).unwrap_or_default();
            execute_hybrid_smart_cut_with_keyframes(video_path, start, end, output_path, &keyframes)
        }
        CutMode::ExactFrame => execute_single_cut(video_path, start, end, output_path, true),
    }
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
    invert_silence_with_padding(silence_intervals, total_duration, 0.0)
}

/// Computes active speech spans while retaining a natural breath padding (`padding_sec`) around
/// vocal boundaries to prevent abrupt consonant clipping.
pub fn invert_silence_with_padding(
    silence_intervals: &[(f64, f64)],
    total_duration: f64,
    padding_sec: f64,
) -> Vec<(f64, f64)> {
    let pad = padding_sec.max(0.0);
    let mut active = Vec::new();
    let mut current_pos = 0.0;

    for &(silence_start, silence_end) in silence_intervals {
        let eff_start = if silence_start <= 0.001 {
            0.0
        } else {
            silence_start + pad
        };
        let eff_end = if (total_duration - silence_end).abs() <= 0.001 {
            total_duration
        } else {
            silence_end - pad
        };

        if eff_end <= eff_start {
            // Pause is narrower than 2 * padding_sec; bridge speech seamlessly
            continue;
        }

        if eff_start > current_pos {
            active.push((current_pos, eff_start.min(total_duration)));
        }
        current_pos = current_pos.max(eff_end);
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

    ensure_distinct_paths(video_path, output_path)?;

    if segments.len() == 1 {
        let (s, e) = segments[0];
        return lossless_cut_with_mode(video_path, s, e, output_path, mode);
    }

    // Pre-extract keyframes once when using SmartCopy to avoid N redundant ffprobe scans
    let cached_keyframes = if mode == CutMode::SmartCopy {
        get_keyframes(video_path).unwrap_or_default()
    } else {
        Vec::new()
    };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_dir = std::env::temp_dir().join(format!("snipflow_concat_{timestamp}"));
    std::fs::create_dir_all(&tmp_dir)?;

    let extension = output_path
        .extension()
        .or_else(|| video_path.extension())
        .unwrap_or_default()
        .to_string_lossy();
    let ext_str = if extension.is_empty() { "mp4" } else { &extension };

    let mut tmp_clips = Vec::new();
    let mut concat_entries = Vec::new();

    for (idx, &(s, e)) in segments.iter().enumerate() {
        if e <= s {
            continue;
        }
        let clip_file_name = format!("chunk_{:03}.{}", idx, ext_str);
        let clip_path = tmp_dir.join(&clip_file_name);

        let cut_res = match mode {
            CutMode::StreamCopy => execute_single_cut(video_path, s, e, &clip_path, false),
            CutMode::SmartCopy => execute_hybrid_smart_cut_with_keyframes(
                video_path,
                s,
                e,
                &clip_path,
                &cached_keyframes,
            ),
            CutMode::ExactFrame => execute_single_cut(video_path, s, e, &clip_path, true),
        };

        if let Err(err) = cut_res {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return Err(err);
        }

        tmp_clips.push(clip_path);
        concat_entries.push(format!("file '{clip_file_name}'"));
    }

    if tmp_clips.is_empty() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(SnipFlowError::InvalidTimeRange { start: 0.0, end: 0.0 });
    }

    let concat_list_path = tmp_dir.join("concat_list.txt");
    std::fs::write(&concat_list_path, concat_entries.join("\n"))?;

    let abs_output_path = resolve_abs_path(output_path);
    if let Some(parent) = abs_output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let is_mp4_family = is_mp4_family_container(&abs_output_path);
    let ffmpeg_path = find_binary("ffmpeg")?;
    let mut cmd = Command::new(ffmpeg_path);

    cmd.args([
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i",
    ]);
    cmd.arg(&concat_list_path);
    cmd.args([
        "-map", "0:v:0?",
        "-map", "0:a?",
        "-map", "0:s?",
        "-c", "copy",
    ]);
    if is_mp4_family {
        cmd.args(["-movflags", "+faststart"]);
    }
    cmd.arg(&abs_output_path);

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

/// Extracts a single full-resolution video frame at `timestamp_sec` to an image file (PNG or JPEG).
pub fn extract_frame_snapshot(
    video_path: &Path,
    timestamp_sec: f64,
    output_path: &Path,
) -> Result<()> {
    if !video_path.exists() {
        return Err(SnipFlowError::FileNotFound(video_path.to_path_buf()));
    }
    ensure_distinct_paths(video_path, output_path)?;

    let ffmpeg = find_binary("ffmpeg")?;
    let abs_source = resolve_abs_path(video_path);
    let abs_output = resolve_abs_path(output_path);

    if let Some(parent) = abs_output.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut cmd = Command::new(ffmpeg);
    cmd.args([
        "-ss",
        &format!("{:.4}", timestamp_sec.max(0.0)),
        "-i",
    ]);
    cmd.arg(&abs_source);
    cmd.args([
        "-frames:v",
        "1",
        "-q:v",
        "2",
        "-y",
    ]);
    cmd.arg(&abs_output);

    run_command(&mut cmd, "ffmpeg frame snapshot")?;

    if !abs_output.is_file() {
        return Err(SnipFlowError::FileNotFound(abs_output));
    }

    Ok(())
}
