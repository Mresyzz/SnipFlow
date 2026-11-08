use std::path::Path;
use std::process::Command;
use regex::Regex;
use crate::core::ffmpeg::{find_binary, get_audio_streams, run_command};
use crate::error::{Result, SnipFlowError};

/// Scans both audio transient loudness (EBU R128 with vocal/action bandpass) and video keyframe
/// scene changes (`select='gt(scene,0.32)'`) concurrently to extract multimodal highlight timestamps.
pub fn detect_peak_highlights(
    video_path: &Path,
    peak_threshold_lufs: f64,
) -> Result<Vec<f64>> {
    if !video_path.exists() {
        return Err(SnipFlowError::FileNotFound(video_path.to_path_buf()));
    }

    let has_audio = get_audio_streams(video_path)
        .map(|tracks| !tracks.is_empty())
        .unwrap_or(false);

    // Run audio EBU R128 and visual I-frame scene-change scans in parallel threads
    let (audio_res, visual_res) = std::thread::scope(|s| {
        let audio_handle = s.spawn(|| {
            if has_audio {
                detect_audio_ebur128_peaks(video_path, peak_threshold_lufs).unwrap_or_default()
            } else {
                Vec::new()
            }
        });
        let visual_handle = s.spawn(|| {
            detect_visual_scene_highlights(video_path, 0.32).unwrap_or_default()
        });

        (
            audio_handle.join().unwrap_or_default(),
            visual_handle.join().unwrap_or_default(),
        )
    });

    let mut combined_peaks = Vec::with_capacity(audio_res.len() + visual_res.len());
    combined_peaks.extend(audio_res);
    combined_peaks.extend(visual_res);

    Ok(merge_and_dedup_peaks(&mut combined_peaks, 3.0))
}

/// Scans audio stream for momentary loudness spikes while attenuating keyboard click noise (>6kHz)
/// and desk thumps (<120Hz).
fn detect_audio_ebur128_peaks(video_path: &Path, peak_threshold_lufs: f64) -> Result<Vec<f64>> {
    let ffmpeg_path = find_binary("ffmpeg")?;
    let mut cmd = Command::new(ffmpeg_path);

    cmd.args([
        "-nostats",
        "-hide_banner",
        "-vn",
        "-i",
    ]);
    cmd.arg(video_path);
    cmd.args([
        "-af",
        "highpass=f=120,lowpass=f=6000,ebur128=metadata=1",
        "-f",
        "null",
        "-",
    ]);

    let output = run_command(&mut cmd, "ffmpeg detect audio peak highlights")?;
    let stderr = String::from_utf8_lossy(&output.stderr);

    parse_ebur128_peaks(&stderr, peak_threshold_lufs)
}

/// Scans I-frames only (`-skip_frame nokey`) for visual scene transitions (`scene > threshold`).
pub fn detect_visual_scene_highlights(video_path: &Path, scene_threshold: f64) -> Result<Vec<f64>> {
    let ffmpeg_path = find_binary("ffmpeg")?;
    let mut cmd = Command::new(ffmpeg_path);

    let vf_expr = format!("select='gt(scene,{:.2})',showinfo", scene_threshold.clamp(0.1, 0.9));

    cmd.args([
        "-nostats",
        "-hide_banner",
        "-skip_frame", "nokey",
        "-an",
        "-i",
    ]);
    cmd.arg(video_path);
    cmd.args([
        "-vf",
        &vf_expr,
        "-f",
        "null",
        "-",
    ]);

    let output = run_command(&mut cmd, "ffmpeg detect visual scene highlights")?;
    let stderr = String::from_utf8_lossy(&output.stderr);

    parse_showinfo_scene_peaks(&stderr)
}

/// Parses EBU R128 momentary loudness records from FFmpeg output.
pub fn parse_ebur128_peaks(stderr: &str, threshold_lufs: f64) -> Result<Vec<f64>> {
    let re_record = Regex::new(r"t:\s*([0-9.]+)\s+TARGET:.*M:\s*([-\w.]+)")
        .map_err(|e| SnipFlowError::ParseError(e.to_string()))?;

    let mut peaks = Vec::new();
    let mut last_peak_time: f64 = -10.0;

    for line in stderr.lines() {
        if let Some(caps) = re_record.captures(line) {
            let t_str = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let m_str = caps.get(2).map(|m| m.as_str()).unwrap_or("");

            if let (Ok(t), Ok(m)) = (t_str.parse::<f64>(), m_str.parse::<f64>()) {
                if m >= threshold_lufs && (t - last_peak_time) > 3.0 {
                    peaks.push(t);
                    last_peak_time = t;
                }
            }
        }
    }

    Ok(peaks)
}

/// Parses `showinfo` filter timestamps (`pts_time:12.345`) from FFmpeg stderr.
pub fn parse_showinfo_scene_peaks(stderr: &str) -> Result<Vec<f64>> {
    let re_pts = Regex::new(r"pts_time:\s*([0-9]+(?:\.[0-9]+)?)")
        .map_err(|e| SnipFlowError::ParseError(e.to_string()))?;

    let mut peaks = Vec::new();
    for line in stderr.lines() {
        if let Some(caps) = re_pts.captures(line) {
            if let Some(m) = caps.get(1) {
                if let Ok(t) = m.as_str().parse::<f64>() {
                    if t > 0.1 {
                        peaks.push(t);
                    }
                }
            }
        }
    }

    Ok(peaks)
}

/// Merges and deduplicates multimodal timestamps enforcing a minimum cooldown window.
pub fn merge_and_dedup_peaks(peaks: &mut [f64], min_cooldown_sec: f64) -> Vec<f64> {
    peaks.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let mut result = Vec::new();
    let mut last_ts = -min_cooldown_sec * 2.0;

    for &t in peaks.iter() {
        if t >= 0.0 && (t - last_ts) >= min_cooldown_sec {
            result.push((t * 100.0).round() / 100.0);
            last_ts = t;
        }
    }

    result
}

/// Converts discrete highlight timestamps into non-overlapping active clip intervals
/// `[peak - pre_roll, peak + post_roll]` clamped to `[0.0, total_duration]`.
pub fn build_highlight_segments(
    peaks: &[f64],
    total_duration: f64,
    pre_roll: f64,
    post_roll: f64,
) -> Vec<(f64, f64)> {
    if peaks.is_empty() || total_duration <= 0.0 {
        return Vec::new();
    }

    let pre = pre_roll.max(0.5);
    let post = post_roll.max(0.5);

    let mut sorted = peaks.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let mut merged: Vec<(f64, f64)> = Vec::new();

    for p in sorted {
        let start = (p - pre).max(0.0);
        let end = (p + post).min(total_duration);
        if end <= start {
            continue;
        }

        if let Some(last) = merged.last_mut() {
            if start <= last.1 + 0.25 {
                last.1 = last.1.max(end);
                continue;
            }
        }
        merged.push((
            (start * 100.0).round() / 100.0,
            (end * 100.0).round() / 100.0,
        ));
    }

    merged
}
