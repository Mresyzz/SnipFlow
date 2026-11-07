use std::path::Path;
use std::process::Command;
use crate::core::ffmpeg::{find_binary, run_command};
use crate::error::{Result, SnipFlowError};

/// Extracts downsampled RMS waveform energy envelope (normalized 0.0 ~ 1.0) for visual timeline rendering.
///
/// Executes an ultra-fast raw PCM stream extraction with 1000Hz mono downsampling,
/// processing hours of audio in milliseconds without video decoding.
pub fn generate_waveform_peaks(
    video_path: &Path,
    samples_count: usize,
    track_index: Option<usize>,
) -> Result<Vec<f32>> {
    if !video_path.exists() {
        return Err(SnipFlowError::FileNotFound(video_path.to_path_buf()));
    }

    if samples_count == 0 {
        return Ok(Vec::new());
    }

    let ffmpeg_path = find_binary("ffmpeg")?;
    let mut cmd = Command::new(ffmpeg_path);

    let map_arg = format!("0:a:{}", track_index.unwrap_or(0));

    // Downsample to 1000Hz mono signed 16-bit little-endian PCM
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
        "-ac",
        "1",
        "-ar",
        "1000",
        "-f",
        "s16le",
        "-",
    ]);

    let output = run_command(&mut cmd, "ffmpeg generate waveform")?;
    let raw_bytes = output.stdout;

    if raw_bytes.is_empty() {
        return Ok(vec![0.0; samples_count]);
    }

    // Convert bytes into i16 samples
    let sample_count = raw_bytes.len() / 2;
    if sample_count == 0 {
        return Ok(vec![0.0; samples_count]);
    }

    let mut samples = Vec::with_capacity(sample_count);
    for chunk in raw_bytes.chunks_exact(2) {
        let val = i16::from_le_bytes([chunk[0], chunk[1]]);
        samples.push(val);
    }

    // Decimate/bucket into target samples_count and compute RMS per bucket
    let bucket_size = (sample_count as f64 / samples_count as f64).max(1.0);
    let mut peaks = Vec::with_capacity(samples_count);
    let mut max_rms: f64 = 0.001;

    for i in 0..samples_count {
        let start_idx = ((i as f64) * bucket_size) as usize;
        let end_idx = (((i + 1) as f64) * bucket_size).min(sample_count as f64) as usize;

        if start_idx >= sample_count || start_idx >= end_idx {
            peaks.push(0.0);
            continue;
        }

        let slice = &samples[start_idx..end_idx];
        let mut sum_sq: f64 = 0.0;
        for &s in slice {
            let norm = (s as f64) / 32768.0;
            sum_sq += norm * norm;
        }
        let rms = (sum_sq / slice.len() as f64).sqrt();
        if rms > max_rms {
            max_rms = rms;
        }
        peaks.push(rms as f32);
    }

    // Normalize peaks to 0.0 ~ 1.0
    if max_rms > 0.0 {
        for p in &mut peaks {
            *p = (*p / max_rms as f32).min(1.0);
        }
    }

    Ok(peaks)
}
