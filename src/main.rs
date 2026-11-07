use std::env;
use std::path::PathBuf;
use std::time::Instant;
use snipflow::{
    detect_silence, get_duration, get_keyframes, invert_silence, lossless_cut,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("--------------------------------------------------");
    println!("  SnipFlow Core Engine - Media Triage Pipeline    ");
    println!("--------------------------------------------------");

    let args: Vec<String> = env::args().collect();
    let video_path = if args.len() > 1 {
        PathBuf::from(&args[1])
    } else {
        let default_candidates = ["sample.mp4", "test.mp4", "input.mp4"];
        let found = default_candidates
            .iter()
            .map(PathBuf::from)
            .find(|p| p.is_file());

        match found {
            Some(p) => p,
            None => {
                eprintln!("Usage: snipflow <input_video_path> [output_cut_path]");
                eprintln!();
                eprintln!("Example:");
                eprintln!("  snipflow ./recordings/stream_vod.mp4 ./cuts/highlight.mp4");
                eprintln!();
                eprintln!("No input video specified and no local 'sample.mp4' found.");
                return Ok(());
            }
        }
    };

    let output_path = if args.len() > 2 {
        PathBuf::from(&args[2])
    } else {
        PathBuf::from("output_cut.mp4")
    };

    println!("[*] Source Asset: {}", video_path.display());

    // 1. Probe total duration
    let duration = match get_duration(&video_path) {
        Ok(d) => {
            println!("[✓] Stream Duration: {:.3}s ({:.2} min)", d, d / 60.0);
            d
        }
        Err(e) => {
            eprintln!("[!] Failed to probe duration: {e}");
            return Err(e.into());
        }
    };

    // 2. Extract Keyframes (I-frames) for Magnetic Timeline Snapping
    println!("\n[*] Scanning keyframes (packet PTS)...");
    let t0 = Instant::now();
    let keyframes = get_keyframes(&video_path)?;
    let keyframe_elapsed = t0.elapsed();

    println!(
        "[✓] Extracted {} keyframes in {:.2}ms",
        keyframes.len(),
        keyframe_elapsed.as_secs_f64() * 1000.0
    );

    if !keyframes.is_empty() {
        let display_limit = keyframes.len().min(8);
        let preview: Vec<String> = keyframes[..display_limit]
            .iter()
            .map(|ts| format!("{ts:.3}s"))
            .collect();
        println!("    First {display_limit} keyframes: [{}]", preview.join(", "));
    }

    // 3. Audio Silence Stripping Scan
    let noise_threshold_db = -30.0;
    let min_silence_duration = 0.5;
    println!(
        "\n[*] Analyzing audio track for dead-air (Threshold: {noise_threshold_db}dB, Min Span: {min_silence_duration}s)..."
    );

    let t1 = Instant::now();
    let silence_intervals = detect_silence(&video_path, noise_threshold_db, min_silence_duration)?;
    let silence_elapsed = t1.elapsed();

    let total_silence_sec: f64 = silence_intervals
        .iter()
        .map(|(s, e)| (e - s).max(0.0))
        .sum();

    println!(
        "[✓] Found {} silent regions ({:.2}s dead air) in {:.2}ms",
        silence_intervals.len(),
        total_silence_sec,
        silence_elapsed.as_secs_f64() * 1000.0
    );

    for (idx, (s, e)) in silence_intervals.iter().take(5).enumerate() {
        println!("    [{idx}] Silence: {s:.3}s -> {e:.3}s (span: {:.3}s)", e - s);
    }
    if silence_intervals.len() > 5 {
        println!("    ... and {} more regions", silence_intervals.len() - 5);
    }

    // Invert silence intervals to calculate clean active speech segments
    let active_segments = invert_silence(&silence_intervals, duration);
    println!("[*] Identified {} active content segments.", active_segments.len());

    // 4. Lossless Stream Copy Demo
    // Determine target range: cut first active segment, or fallback to first 10 seconds
    let (cut_start, cut_end) = if let Some(&(start, end)) = active_segments.first() {
        (start, end.min(start + 15.0))
    } else {
        (0.0, duration.min(10.0))
    };

    println!(
        "\n[*] Executing zero-reencode lossless cut: [{:.3}s -> {:.3}s] (Duration: {:.3}s)",
        cut_start,
        cut_end,
        cut_end - cut_start
    );
    println!("    Destination: {}", output_path.display());

    let t2 = Instant::now();
    lossless_cut(&video_path, cut_start, cut_end, &output_path)?;
    let cut_elapsed = t2.elapsed();

    println!(
        "[✓] Export completed successfully in {:.2}ms (Zero Re-encoding)",
        cut_elapsed.as_secs_f64() * 1000.0
    );
    println!("--------------------------------------------------");

    Ok(())
}
