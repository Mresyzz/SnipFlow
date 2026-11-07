//! # SnipFlow Core Engine
//!
//! Ultra-fast, local-first lossless video clipper & silence stripper powered by Rust and FFmpeg.

pub mod core;
pub mod error;

pub use core::cut::{invert_silence, lossless_cut, seamless_merge};
pub use core::ffmpeg::{find_binary, get_audio_streams, get_duration, AudioStreamInfo};
pub use core::highlight::detect_peak_highlights;
pub use core::keyframe::get_keyframes;
pub use core::silence::{detect_silence, detect_silence_track};
pub use core::waveform::generate_waveform_peaks;
pub use error::{Result, SnipFlowError};
