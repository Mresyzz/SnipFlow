#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::env;
use std::path::{Path, PathBuf};
use std::time::Instant;
use snipflow::{
    detect_silence, export_cmx3600_edl, export_fcpxml, get_duration, get_keyframes,
    invert_silence_with_padding, lossless_cut_with_mode, probe_audio_volume,
    seamless_merge_with_mode, CutMode,
};

fn is_supported_video_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "mp4" | "mkv" | "mov" | "webm" | "avi" | "flv" | "ts" | "m4v"
            )
        })
        .unwrap_or(false)
}

fn print_cli_help() {
    println!("SnipFlow v0.7.3 - Zero-Reencode Video Clipper & Silence Stripper");
    println!();
    println!("USAGE:");
    println!("  snipflow                                      Launch desktop studio GUI");
    println!("  snipflow --cli <input> [output]               Single-file silence strip & cut");
    println!("  snipflow --batch <dir_or_files...> [options]  Headless batch silence stripping");
    println!("  snipflow --snapshot <input> <sec> [output]    Extract high-fidelity frame snapshot");
    println!("  snipflow --audio <input> [output.m4a/mp3]     Extract audio stream losslessly");
    println!();
    println!("BATCH OPTIONS:");
    println!("  --out-dir <dir>       Output directory for cleaned videos");
    println!("  --db <float>          Silence threshold in dB (default: auto-calibrated via volumedetect)");
    println!("  --min-silence <sec>   Minimum silence duration in seconds (default: 0.5)");
    println!("  --mode <mode>         Cut engine: copy | smart | exact (default: smart)");
    println!("  --nle                 Also export CMX 3600 (.edl) & Final Cut (.fcpxml) timelines");
}

fn run_cli_mode(video_path: PathBuf, output_path: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    println!("--------------------------------------------------");
    println!("  SnipFlow Core Engine - Media Triage Pipeline    ");
    println!("--------------------------------------------------");
    println!("[*] Source Asset: {}", video_path.display());

    let duration = get_duration(&video_path)?;
    println!("[OK] Stream Duration: {:.3}s ({:.2} min)", duration, duration / 60.0);

    let t0 = Instant::now();
    let keyframes = get_keyframes(&video_path)?;
    println!(
        "[OK] Extracted {} keyframes in {:.2}ms",
        keyframes.len(),
        t0.elapsed().as_secs_f64() * 1000.0
    );

    let profile = probe_audio_volume(&video_path, None)?;
    println!(
        "[OK] Audio Profile: mean {:.1}dB, max {:.1}dB -> calibrated threshold {:.1}dB",
        profile.mean_volume_db, profile.max_volume_db, profile.recommended_silence_db
    );

    let t1 = Instant::now();
    let silence_intervals = detect_silence(&video_path, profile.recommended_silence_db, 0.5)?;
    println!(
        "[OK] Found {} silent regions in {:.2}ms",
        silence_intervals.len(),
        t1.elapsed().as_secs_f64() * 1000.0
    );

    let active_segments = invert_silence_with_padding(&silence_intervals, duration, 0.06);
    let t2 = Instant::now();

    if active_segments.len() > 1 {
        println!(
            "[*] Seamless merging {} active speech segments -> {}",
            active_segments.len(),
            output_path.display()
        );
        seamless_merge_with_mode(&video_path, &active_segments, &output_path, CutMode::SmartCopy)?;
    } else {
        let (cut_start, cut_end) = active_segments
            .first()
            .copied()
            .unwrap_or((0.0, duration));
        println!(
            "[*] Exporting segment [{:.3}s -> {:.3}s] -> {}",
            cut_start,
            cut_end,
            output_path.display()
        );
        lossless_cut_with_mode(&video_path, cut_start, cut_end, &output_path, CutMode::SmartCopy)?;
    }

    println!(
        "[OK] Export completed in {:.2}ms",
        t2.elapsed().as_secs_f64() * 1000.0
    );
    println!("--------------------------------------------------");

    Ok(())
}

fn run_batch_mode(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let mut input_targets: Vec<PathBuf> = Vec::new();
    let mut out_dir: Option<PathBuf> = None;
    let mut custom_db: Option<f64> = None;
    let mut min_silence: f64 = 0.5;
    let mut mode = CutMode::SmartCopy;
    let mut export_nle = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--out-dir" if i + 1 < args.len() => {
                out_dir = Some(PathBuf::from(&args[i + 1]));
                i += 2;
            }
            "--db" if i + 1 < args.len() => {
                custom_db = args[i + 1].parse::<f64>().ok();
                i += 2;
            }
            "--min-silence" if i + 1 < args.len() => {
                if let Ok(v) = args[i + 1].parse::<f64>() {
                    min_silence = v.max(0.1);
                }
                i += 2;
            }
            "--mode" if i + 1 < args.len() => {
                mode = match args[i + 1].as_str() {
                    "copy" | "stream_copy" => CutMode::StreamCopy,
                    "exact" | "exact_frame" => CutMode::ExactFrame,
                    _ => CutMode::SmartCopy,
                };
                i += 2;
            }
            "--nle" => {
                export_nle = true;
                i += 1;
            }
            arg if !arg.starts_with("--") => {
                let p = PathBuf::from(arg);
                if p.is_dir() {
                    if let Ok(entries) = std::fs::read_dir(&p) {
                        for entry in entries.flatten() {
                            let ep = entry.path();
                            if ep.is_file() && is_supported_video_file(&ep) {
                                input_targets.push(ep);
                            }
                        }
                    }
                } else if p.is_file() {
                    input_targets.push(p);
                }
                i += 1;
            }
            _ => {
                i += 1;
            }
        }
    }

    if input_targets.is_empty() {
        return Err("No valid video files found for --batch processing.".into());
    }

    println!("--------------------------------------------------");
    println!(
        "  SnipFlow Headless Batch Pipeline ({} files)",
        input_targets.len()
    );
    println!("--------------------------------------------------");

    let batch_start = Instant::now();
    let mut processed_count = 0usize;

    for (idx, video_path) in input_targets.iter().enumerate() {
        println!(
            "[{}/{}] Processing: {}",
            idx + 1,
            input_targets.len(),
            video_path.display()
        );

        let duration = match get_duration(video_path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("  [!] Skipping corrupt file {}: {}", video_path.display(), e);
                continue;
            }
        };

        let threshold_db = match custom_db {
            Some(db) => db,
            None => probe_audio_volume(video_path, None)
                .map(|p| p.recommended_silence_db)
                .unwrap_or(-30.0),
        };

        let silences = detect_silence(video_path, threshold_db, min_silence).unwrap_or_default();
        let active = if silences.is_empty() {
            vec![(0.0, duration)]
        } else {
            invert_silence_with_padding(&silences, duration, 0.06)
        };

        let stem = video_path.file_stem().unwrap_or_default().to_string_lossy();
        let ext = video_path.extension().unwrap_or_default().to_string_lossy();
        let ext_str = if ext.is_empty() { "mp4" } else { &ext };

        let target_dir = match &out_dir {
            Some(d) => d.clone(),
            None => video_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join("snipflow_batch_out"),
        };
        std::fs::create_dir_all(&target_dir)?;
        let out_file = target_dir.join(format!("{stem}_clean.{ext_str}"));

        if active.is_empty() {
            eprintln!("  [!] File is 100% silent, skipping export.");
            continue;
        }

        if export_nle {
            let edl_file = target_dir.join(format!("{stem}_timeline.edl"));
            let xml_file = target_dir.join(format!("{stem}_timeline.fcpxml"));
            let _ = export_cmx3600_edl(video_path, &active, 30, &edl_file);
            let _ = export_fcpxml(video_path, &active, duration, &xml_file);
        }

        let res = seamless_merge_with_mode(video_path, &active, &out_file, mode);
        match res {
            Ok(()) => {
                processed_count += 1;
                println!(
                    "  [OK] Saved {} ({} active segments, threshold {:.1}dB)",
                    out_file.display(),
                    active.len(),
                    threshold_db
                );
            }
            Err(e) => {
                eprintln!("  [!] Export failed for {}: {}", video_path.display(), e);
            }
        }
    }

    println!("--------------------------------------------------");
    println!(
        "[OK] Batch finished: {}/{} files exported in {:.2}s",
        processed_count,
        input_targets.len(),
        batch_start.elapsed().as_secs_f64()
    );
    Ok(())
}

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() > 1 {
        match args[1].as_str() {
            "--help" | "-h" => {
                print_cli_help();
                return;
            }
            "--snapshot" => {
                if args.len() < 4 {
                    eprintln!("[!] Missing arguments for --snapshot: snipflow --snapshot <input> <sec> [output]");
                    std::process::exit(1);
                }
                let input_path = PathBuf::from(&args[2]);
                let sec = match args[3].parse::<f64>() {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("[!] Invalid timestamp seconds: {e}");
                        std::process::exit(1);
                    }
                };
                let output_path = if args.len() > 4 {
                    PathBuf::from(&args[4])
                } else {
                    let parent = input_path.parent().unwrap_or_else(|| Path::new("."));
                    let stem = input_path.file_stem().and_then(|s| s.to_str()).unwrap_or("video");
                    let sec_str = format!("{:.2}", sec).replace('.', "_");
                    parent.join(format!("{}_snapshot_{}s.jpg", stem, sec_str))
                };
                if let Err(e) = snipflow::extract_frame_snapshot(&input_path, sec, &output_path) {
                    eprintln!("[!] Snapshot extraction failed: {e}");
                    std::process::exit(1);
                }
                println!("[OK] Extracted snapshot at {:.2}s -> {}", sec, output_path.display());
                return;
            }
            "--audio" => {
                if args.len() < 3 {
                    eprintln!("[!] Missing arguments for --audio: snipflow --audio <input> [output.m4a/mp3]");
                    std::process::exit(1);
                }
                let input_path = PathBuf::from(&args[2]);
                let output_path = if args.len() > 3 {
                    PathBuf::from(&args[3])
                } else {
                    let parent = input_path.parent().unwrap_or_else(|| Path::new("."));
                    let stem = input_path.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
                    parent.join(format!("{}_extracted_audio.m4a", stem))
                };
                if let Err(e) = snipflow::extract_audio_stream(&input_path, None, None, &output_path, None) {
                    eprintln!("[!] Audio extraction failed: {e}");
                    std::process::exit(1);
                }
                println!("[OK] Audio stream extracted -> {}", output_path.display());
                return;
            }
            "--batch" => {
                if let Err(e) = run_batch_mode(&args[2..]) {
                    eprintln!("[!] Batch execution failed: {e}");
                    std::process::exit(1);
                }
                return;
            }
            "--cli" => {
                if args.len() < 3 {
                    eprintln!("[!] Missing input file path for --cli");
                    print_cli_help();
                    std::process::exit(1);
                }
                let input_arg = &args[2];
                let output_arg = if args.len() > 3 {
                    &args[3]
                } else {
                    "output_cut.mp4"
                };
                if let Err(e) = run_cli_mode(PathBuf::from(input_arg), PathBuf::from(output_arg)) {
                    eprintln!("[!] Execution failed: {e}");
                    std::process::exit(1);
                }
                return;
            }
            first if is_supported_video_file(Path::new(first)) => {
                let output_arg = if args.len() > 2 {
                    &args[2]
                } else {
                    "output_cut.mp4"
                };
                if let Err(e) = run_cli_mode(PathBuf::from(first), PathBuf::from(output_arg)) {
                    eprintln!("[!] Execution failed: {e}");
                    std::process::exit(1);
                }
                return;
            }
            _ => {}
        }
    }

    // Default: Launch Tauri v2 desktop application
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::media::check_environment_cmd,
            commands::media::select_video_file_cmd,
            commands::media::select_output_directory_cmd,
            commands::media::validate_media_container_cmd,
            commands::media::inspect_media_cmd,
            commands::media::calibrate_silence_threshold_cmd,
            commands::media::check_keyframe_alignment_cmd,
            commands::media::find_nearest_keyframe_cmd,
            commands::media::rescan_silence_cmd,
            commands::media::extract_track_waveform_cmd,
            commands::media::scan_peak_highlights_cmd,
            commands::cut::lossless_cut_cmd,
            commands::cut::batch_export_segments_cmd,
            commands::cut::export_seamless_merge_cmd,
            commands::cut::export_nle_timeline_cmd,
            commands::cut::export_frame_snapshot_cmd,
            commands::cut::export_audio_only_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running SnipFlow desktop application");
}
