pub mod core;
pub mod error;

pub use crate::core::cut::{
    extract_frame_snapshot, find_next_gop_boundary, invert_silence, invert_silence_with_padding,
    lossless_cut, lossless_cut_with_mode, seamless_merge, seamless_merge_with_mode, CutMode,
};
pub use crate::core::ffmpeg::{
    find_binary, get_audio_streams, get_duration, get_internal_bin_dir, parse_duration_tag_str,
    validate_media_file, AudioStreamInfo, MediaContainerValidation,
};
pub use crate::core::highlight::{
    build_highlight_segments, detect_peak_highlights, detect_visual_scene_highlights,
    merge_and_dedup_peaks, parse_ebur128_peaks, parse_showinfo_scene_peaks,
};
pub use crate::core::keyframe::{
    check_keyframe_alignment, find_nearest_keyframe, get_keyframes, KeyframeAlignment,
};
pub use crate::core::nle::{
    export_cmx3600_edl, export_fcpxml, generate_cmx3600_edl_string, generate_fcpxml_string,
    seconds_to_smpte,
};
pub use crate::core::silence::{
    detect_silence, detect_silence_track, parse_silencedetect_logs, parse_volumedetect_output,
    probe_audio_volume, AudioVolumeProfile,
};
pub use crate::core::waveform::generate_waveform_peaks;
pub use crate::error::{Result, SnipFlowError};
