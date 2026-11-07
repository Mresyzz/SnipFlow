//! # SnipFlow Core Engine
//!
//! Ultra-fast, local-first lossless video clipper & silence stripper powered by Rust and FFmpeg.

pub mod core;
pub mod error;

pub use core::cut::{
    invert_silence, lossless_cut, lossless_cut_with_mode, seamless_merge, seamless_merge_with_mode,
    CutMode,
};
pub use core::ffmpeg::{
    find_binary, get_audio_streams, get_duration, get_internal_bin_dir, validate_media_file,
    AudioStreamInfo, MediaContainerValidation,
};
pub use core::highlight::detect_peak_highlights;
pub use core::keyframe::{check_keyframe_alignment, find_nearest_keyframe, get_keyframes, KeyframeAlignment};
pub use core::silence::{
    detect_silence, detect_silence_track, parse_volumedetect_output, probe_audio_volume,
    AudioVolumeProfile,
};
pub use core::waveform::generate_waveform_peaks;
pub use error::{Result, SnipFlowError};
