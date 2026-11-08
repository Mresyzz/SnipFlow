//! # SnipFlow Core Engine
//!
//! Ultra-fast, local-first lossless video clipper & silence stripper powered by Rust and FFmpeg.

pub mod core;
pub mod error;

pub use core::cut::{
    find_next_gop_boundary, invert_silence, invert_silence_with_padding, lossless_cut,
    lossless_cut_with_mode, seamless_merge, seamless_merge_with_mode, CutMode,
};
pub use core::ffmpeg::{
    find_binary, get_audio_streams, get_duration, get_internal_bin_dir, validate_media_file,
    AudioStreamInfo, MediaContainerValidation,
};
pub use core::highlight::{
    detect_peak_highlights, detect_visual_scene_highlights, merge_and_dedup_peaks,
    parse_ebur128_peaks, parse_showinfo_scene_peaks,
};
pub use core::keyframe::{
    check_keyframe_alignment, find_nearest_keyframe, get_keyframes, KeyframeAlignment,
};
pub use core::nle::{
    export_cmx3600_edl, export_fcpxml, generate_cmx3600_edl_string, generate_fcpxml_string,
    seconds_to_smpte,
};
pub use core::silence::{
    detect_silence, detect_silence_track, parse_silencedetect_logs, parse_volumedetect_output,
    probe_audio_volume, AudioVolumeProfile,
};
pub use core::waveform::generate_waveform_peaks;
pub use error::{Result, SnipFlowError};
