use snipflow::{
    check_keyframe_alignment, find_nearest_keyframe, invert_silence,
    parse_volumedetect_output, CutMode,
};

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
    // Handling overlapping or back-to-back silence detector intervals
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
    // mean_volume - 6.5 = -34.9 dB
    assert_eq!(profile.recommended_silence_db, -34.9);
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
fn test_check_keyframe_alignment() {
    let keyframes = vec![0.0, 2.0, 4.0, 6.0];

    // Aligned case: target is exactly on keyframe or within 18ms
    let aligned = check_keyframe_alignment(&keyframes, 2.008).expect("Should find keyframe");
    assert!(aligned.is_aligned);
    assert_eq!(aligned.nearest_pts, 2.0);
    assert_eq!(aligned.diff_ms, 8.0);

    // Unaligned case: target is in between GOP keyframes
    let unaligned = check_keyframe_alignment(&keyframes, 3.100).expect("Should find keyframe");
    assert!(!unaligned.is_aligned);
    assert_eq!(unaligned.nearest_pts, 4.0);
    assert_eq!(unaligned.diff_ms, -900.0);
}

#[test]
fn test_cut_mode_serde() {
    let json_stream = "\"stream_copy\"";
    let mode: CutMode = serde_json::from_str(json_stream).expect("Failed to deserialize stream_copy");
    assert_eq!(mode, CutMode::StreamCopy);

    let json_exact = "\"exact_frame\"";
    let mode_exact: CutMode = serde_json::from_str(json_exact).expect("Failed to deserialize exact_frame");
    assert_eq!(mode_exact, CutMode::ExactFrame);
}
