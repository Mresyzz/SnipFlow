#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::env;
use std::path::PathBuf;
use std::time::Instant;
use snipflow::{
    detect_silence, get_duration, get_keyframes, invert_silence, lossless_cut,
};

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

    let t1 = Instant::now();
    let silence_intervals = detect_silence(&video_path, -30.0, 0.5)?;
    println!(
        "[OK] Found {} silent regions in {:.2}ms",
        silence_intervals.len(),
        t1.elapsed().as_secs_f64() * 1000.0
    );

    let active_segments = invert_silence(&silence_intervals, duration);
    let (cut_start, cut_end) = if let Some(&(start, end)) = active_segments.first() {
        (start, end.min(start + 15.0))
    } else {
        (0.0, duration.min(10.0))
    };

    println!("[*] Exporting: [{:.3}s -> {:.3}s] -> {}", cut_start, cut_end, output_path.display());
    let t2 = Instant::now();
    lossless_cut(&video_path, cut_start, cut_end, &output_path)?;
    println!("[OK] Export completed in {:.2}ms (Zero Re-encoding)", t2.elapsed().as_secs_f64() * 1000.0);
    println!("--------------------------------------------------");

    Ok(())
}

fn main() {
    let args: Vec<String> = env::args().collect();

    // If explicit file arguments or --cli flag passed, run in CLI mode
    if args.len() > 1 && (args[1] == "--cli" || args[1].ends_with(".mp4") || args[1].ends_with(".mkv") || args[1].ends_with(".mov")) {
        let input_arg = if args[1] == "--cli" { &args[2] } else { &args[1] };
        let output_arg = if args.len() > 2 && args[1] != "--cli" {
            &args[2]
        } else if args.len() > 3 {
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
            commands::media::scan_peak_highlights_cmd,
            commands::cut::lossless_cut_cmd,
            commands::cut::batch_export_segments_cmd,
            commands::cut::export_seamless_merge_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running SnipFlow desktop application");
}
