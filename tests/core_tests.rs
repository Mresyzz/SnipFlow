use snipflow::{
    build_highlight_segments, check_keyframe_alignment, find_nearest_keyframe,
    find_next_gop_boundary, generate_cmx3600_edl_string, generate_fcpxml_string, invert_silence,
    invert_silence_with_padding, lossless_cut_with_mode, merge_and_dedup_peaks,
    parse_duration_tag_str, parse_ebur128_peaks, parse_showinfo_scene_peaks,
    parse_silencedetect_logs, parse_volumedetect_output, seconds_to_smpte, CutMode,
};
use std::path::Path;

#[test]
fn test_invert_silence_with_padding() {
    let silence = vec![(2.0, 4.0), (6.0, 6.1)];
    let active = invert_silence_with_padding(&silence, 10.0, 0.1);
    assert_eq!(active.len(), 2);
    assert!((active[0].0 - 0.0).abs() < 1e-4 && (active[0].1 - 2.1).abs() < 1e-4);
    assert!((active[1].0 - 3.9).abs() < 1e-4 && (active[1].1 - 10.0).abs() < 1e-4);
}

#[test]
fn test_invert_silence_all_silence() {
    let silence = vec![(0.0, 10.0)];
    let active = invert_silence(&silence, 10.0);
    assert!(active.is_empty(), "Entirely silent stream should have 0 active speech segments");
}

#[test]
fn test_invert_silence_no_silence() {
    let silence = vec![];
    let active = invert_silence(&silence, 12.5);
    assert_eq!(active, vec![(0.0, 12.5)], "Clean audio without silence should retain full span");
}

#[test]
fn test_invert_silence_interleaved() {
    let silence = vec![(0.0, 2.0), (5.0, 7.0), (9.0, 10.0)];
    let active = invert_silence(&silence, 10.0);
    assert_eq!(
        active,
        vec![(2.0, 5.0), (7.0, 9.0)],
        "Interleaved silences should produce clean non-silent intervals"
    );
}

#[test]
fn test_invert_silence_overlapping_intervals() {
    let silence = vec![(2.0, 4.5), (4.0, 6.0)];
    let active = invert_silence(&silence, 10.0);
    assert_eq!(
        active,
        vec![(0.0, 2.0), (6.0, 10.0)],
        "Overlapping silence segments should be handled monotonically"
    );
}

#[test]
fn test_parse_volumedetect_output() {
    let sample_stderr = r#"
[Parsed_volumedetect_0 @ 0000021c3d0b2f00] n_samples: 2880000
[Parsed_volumedetect_0 @ 0000021c3d0b2f00] mean_volume: -28.4 dB
[Parsed_volumedetect_0 @ 0000021c3d0b2f00] max_volume: -0.2 dB
[Parsed_volumedetect_0 @ 0000021c3d0b2f00] histogram_0db: 15
"#;

    let profile = parse_volumedetect_output(sample_stderr).expect("Volumedetect parse failed");
    assert_eq!(profile.mean_volume_db, -28.4);
    assert_eq!(profile.max_volume_db, -0.2);
    assert_eq!(profile.recommended_silence_db, -34.9);
}

#[test]
fn test_parse_silencedetect_logs_with_trailing_open_silence() {
    let sample_stderr = r#"
[silencedetect @ 000001] silence_start: 1.500
[silencedetect @ 000001] silence_end: 3.250 | silence_duration: 1.750
[silencedetect @ 000001] silence_start: 8.400
"#;

    let intervals = parse_silencedetect_logs(sample_stderr, Some(10.0)).expect("Parse failed");
    assert_eq!(intervals, vec![(1.5, 3.25), (8.4, 10.0)]);
}

#[test]
fn test_find_nearest_keyframe() {
    let keyframes = vec![0.0, 2.5, 5.0, 7.5, 10.0];

    assert_eq!(find_nearest_keyframe(&[], 3.0), None);
    assert_eq!(find_nearest_keyframe(&keyframes, 0.1), Some(0.0));
    assert_eq!(find_nearest_keyframe(&keyframes, 2.4), Some(2.5));
    assert_eq!(find_nearest_keyframe(&keyframes, 3.8), Some(5.0));
    assert_eq!(find_nearest_keyframe(&keyframes, 11.2), Some(10.0));
}

#[test]
fn test_find_next_gop_boundary() {
    let keyframes = vec![0.0, 2.0, 4.0, 6.0, 8.0, 10.0];

    assert_eq!(find_next_gop_boundary(&keyframes, 2.5, 9.5), Some(4.0));
    assert_eq!(find_next_gop_boundary(&keyframes, 2.2, 3.8), None);
}

#[test]
fn test_check_keyframe_alignment() {
    let keyframes = vec![0.0, 2.0, 4.0, 6.0];

    let aligned = check_keyframe_alignment(&keyframes, 2.008).expect("Should find keyframe");
    assert!(aligned.is_aligned);
    assert_eq!(aligned.nearest_pts, 2.0);
    assert_eq!(aligned.diff_ms, 8.0);

    let unaligned = check_keyframe_alignment(&keyframes, 3.100).expect("Should find keyframe");
    assert!(!unaligned.is_aligned);
    assert_eq!(unaligned.nearest_pts, 4.0);
    assert_eq!(unaligned.diff_ms, -900.0);
}

#[test]
fn test_multimodal_highlights_parsing_and_dedup() {
    let ebu_stderr = r#"
[Parsed_ebur128_0 @ 001] t: 1.200  TARGET:-23 LUFS    M: -18.5 S: -20.1
[Parsed_ebur128_0 @ 001] t: 4.500  TARGET:-23 LUFS    M: -11.2 S: -14.0
[Parsed_ebur128_0 @ 001] t: 5.100  TARGET:-23 LUFS    M: -10.8 S: -13.2
[Parsed_ebur128_0 @ 001] t: 12.800 TARGET:-23 LUFS    M: -9.5  S: -12.1
"#;
    let audio_peaks = parse_ebur128_peaks(ebu_stderr, -14.0).expect("EBU parse failed");
    assert_eq!(audio_peaks, vec![4.5, 12.8]);

    let scene_stderr = r#"
[Parsed_showinfo_1 @ 002] n:   12 pts:  12400 pts_time:5.200   pos: 192000
[Parsed_showinfo_1 @ 002] n:   45 pts:  48000 pts_time:20.000  pos: 892000
"#;
    let visual_peaks = parse_showinfo_scene_peaks(scene_stderr).expect("Scene parse failed");
    assert_eq!(visual_peaks, vec![5.2, 20.0]);

    let mut combined = [audio_peaks, visual_peaks].concat();
    let merged = merge_and_dedup_peaks(&mut combined, 3.0);
    assert_eq!(merged, vec![4.5, 12.8, 20.0]);
}

#[test]
fn test_cut_mode_serde() {
    let mode_copy: CutMode = serde_json::from_str("\"stream_copy\"").unwrap();
    assert_eq!(mode_copy, CutMode::StreamCopy);

    let mode_smart: CutMode = serde_json::from_str("\"smart_copy\"").unwrap();
    assert_eq!(mode_smart, CutMode::SmartCopy);

    let mode_exact: CutMode = serde_json::from_str("\"exact_frame\"").unwrap();
    assert_eq!(mode_exact, CutMode::ExactFrame);
}

#[test]
fn test_nle_edl_and_fcpxml_generation() {
    assert_eq!(seconds_to_smpte(0.0, 30), "00:00:00:00");
    assert_eq!(seconds_to_smpte(65.5, 30), "00:01:05:15");

    let segments = vec![(1.0, 3.5), (5.0, 8.0)];
    let edl = generate_cmx3600_edl_string("demo_lecture.mp4", &segments, 30);
    assert!(edl.contains("TITLE: SnipFlow_demo_lecture.mp4"));
    assert!(edl.contains("001  AX       AA/V  C"));
    assert!(edl.contains("* FROM CLIP NAME: demo_lecture.mp4"));

    let xml = generate_fcpxml_string(Path::new("demo_lecture.mp4"), &segments, 12.0);
    assert!(xml.contains("<fcpxml version=\"1.9\">"));
    assert!(xml.contains("demo_lecture.mp4"));
    assert!(xml.contains("<asset-clip name=\"demo_lecture.mp4\""));
    assert!(xml.contains("offset=\"0/1000s\" start=\"1000/1000s\" duration=\"2500/1000s\""));
}

#[test]
fn test_same_path_overwrite_protection() {
    let existing = Path::new("Cargo.toml");
    let res = lossless_cut_with_mode(existing, 0.0, 5.0, existing, CutMode::StreamCopy);
    assert!(res.is_err(), "Exporting to the exact same path as source must be rejected");

    let case_variant = Path::new("cargo.TOML");
    let res_case = lossless_cut_with_mode(existing, 0.0, 5.0, case_variant, CutMode::StreamCopy);
    assert!(res_case.is_err(), "Exporting with different case on same file must be rejected");
}

#[test]
fn test_audio_extraction_same_path_protection() {
    let existing = Path::new("Cargo.toml");
    let res = snipflow::extract_audio_stream(existing, None, None, existing, None);
    assert!(res.is_err(), "Audio extraction to same path must be rejected");
}

#[test]
fn test_batch_export_empty_segments() {
    let non_existent = Path::new("non_existent.mp4");
    let out_dir = Path::new("test_out");
    let res = snipflow::batch_export_segments_with_mode(
        non_existent,
        &[],
        out_dir,
        "clip",
        "mp4",
        CutMode::StreamCopy,
    );
    assert!(res.is_err(), "Non-existent source media should fail");
}

#[test]
fn test_parse_duration_tag_str() {
    assert_eq!(parse_duration_tag_str("N/A"), None);
    assert_eq!(parse_duration_tag_str(""), None);
    assert_eq!(parse_duration_tag_str("125.5"), Some(125.5));
    assert_eq!(parse_duration_tag_str("00:02:05.500000000"), Some(125.5));
    assert_eq!(parse_duration_tag_str("01:00:00.00"), Some(3600.0));
}

#[test]
fn test_build_highlight_segments() {
    // Two close peaks at 10.0s and 14.0s (with pre=2.5, post=4.5 -> [7.5, 14.5] and [11.5, 18.5] merge into [7.5, 18.5])
    // Third peak at 30.0s -> [27.5, 34.5]
    let peaks = vec![10.0, 14.0, 30.0];
    let segments = build_highlight_segments(&peaks, 40.0, 2.5, 4.5);
    assert_eq!(segments, vec![(7.5, 18.5), (27.5, 34.5)]);
}

#[test]
fn test_snapshot_same_path_protection() {
    let existing = Path::new("Cargo.toml");
    let res = snipflow::extract_frame_snapshot(existing, 1.0, existing);
    assert!(res.is_err(), "Snapshot export to the exact same file path as source must be rejected");
}

#[test]
fn test_snapshot_nonexistent_file() {
    let non_existent = Path::new("non_existent_video_path.mp4");
    let out = Path::new("snapshot.jpg");
    let res = snipflow::extract_frame_snapshot(non_existent, 1.0, out);
    assert!(res.is_err(), "Snapshot of nonexistent media should fail with FileNotFound error");
}
