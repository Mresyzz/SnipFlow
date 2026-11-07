use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use serde::{Deserialize, Serialize};
use crate::error::{Result, SnipFlowError};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows creation flag to prevent child console windows from flashing
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AudioStreamInfo {
    pub stream_index: usize,
    pub track_index: usize,
    pub codec: String,
    pub channels: u32,
    pub title: Option<String>,
}

/// Resolves the absolute path for an FFmpeg multimedia binary.
pub fn find_binary(binary_name: &str) -> Result<PathBuf> {
    // 1. Check custom environment override (e.g. SNIPFLOW_FFMPEG or FFMPEG_PATH)
    let env_key = format!("SNIPFLOW_{}", binary_name.to_uppercase());
    if let Ok(custom_path) = std::env::var(&env_key) {
        let path = PathBuf::from(custom_path);
        if path.is_file() {
            return Ok(path);
        }
    }

    let generic_env = format!("{}_PATH", binary_name.to_uppercase());
    if let Ok(custom_path) = std::env::var(&generic_env) {
        let path = PathBuf::from(custom_path);
        if path.is_file() {
            return Ok(path);
        }
    }

    // 2. Check application directory / sibling bin directory
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            let direct_candidate = parent.join(format_exe_name(binary_name));
            if direct_candidate.is_file() {
                return Ok(direct_candidate);
            }
            let bin_candidate = parent.join("bin").join(format_exe_name(binary_name));
            if bin_candidate.is_file() {
                return Ok(bin_candidate);
            }
        }
    }

    // 3. Check ~/.snipflow/bin or %APPDATA%/SnipFlow/bin
    if let Ok(user_home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let home_bin = PathBuf::from(user_home)
            .join(".snipflow")
            .join("bin")
            .join(format_exe_name(binary_name));
        if home_bin.is_file() {
            return Ok(home_bin);
        }
    }

    if let Ok(appdata) = std::env::var("APPDATA") {
        let appdata_bin = PathBuf::from(appdata)
            .join("SnipFlow")
            .join("bin")
            .join(format_exe_name(binary_name));
        if appdata_bin.is_file() {
            return Ok(appdata_bin);
        }
    }

    // 4. Resolve absolute path from system PATH environment variable
    let exe_name = format_exe_name(binary_name);
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(&exe_name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    // 5. Final fallback probe
    let mut probe_cmd = Command::new(&exe_name);
    probe_cmd.arg("-version");
    apply_platform_flags(&mut probe_cmd);

    match probe_cmd.output() {
        Ok(out) if out.status.success() => Ok(PathBuf::from(exe_name)),
        _ => Err(SnipFlowError::BinaryNotFound {
            binary: binary_name.to_string(),
        }),
    }
}

/// Formats the binary name based on the host operating system.
pub fn format_exe_name(base: &str) -> String {
    if cfg!(target_os = "windows") && !base.ends_with(".exe") {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// Returns the default internal binary directory for auto-provisioning
pub fn get_internal_bin_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("SnipFlow").join("bin");
    }
    if let Ok(user_home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        return PathBuf::from(user_home).join(".snipflow").join("bin");
    }
    PathBuf::from("bin")
}

/// Applies system-specific background process flags.
pub fn apply_platform_flags(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

/// Executes a multimedia command and checks for non-zero exit status.
pub fn run_command(command: &mut Command, desc: &str) -> Result<Output> {
    apply_platform_flags(command);

    let output = command.output()?;
    if !output.status.success() {
        let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(SnipFlowError::CommandExecutionFailed {
            command: desc.to_string(),
            exit_code: output.status.code(),
            stderr: stderr_str,
        });
    }

    Ok(output)
}

/// Queries container stream duration in seconds using ffprobe.
pub fn get_duration(video_path: &Path) -> Result<f64> {
    let ffprobe_path = find_binary("ffprobe")?;
    let mut cmd = Command::new(ffprobe_path);
    cmd.args([
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
    ]);
    cmd.arg(video_path);

    let output = run_command(&mut cmd, "ffprobe probe duration")?;
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout_str.trim();

    trimmed.parse::<f64>().map_err(|e| {
        SnipFlowError::ParseError(format!("Failed to parse stream duration '{trimmed}': {e}"))
    })
}

#[derive(Deserialize)]
struct FFprobeStream {
    index: usize,
    codec_name: Option<String>,
    channels: Option<u32>,
    tags: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct FFprobeOutput {
    streams: Option<Vec<FFprobeStream>>,
}

/// Extracts all audio tracks and metadata from the media container
pub fn get_audio_streams(video_path: &Path) -> Result<Vec<AudioStreamInfo>> {
    let ffprobe_path = find_binary("ffprobe")?;
    let mut cmd = Command::new(ffprobe_path);
    cmd.args([
        "-v", "error",
        "-select_streams", "a",
        "-show_entries", "stream=index,codec_name,channels:stream_tags=title",
        "-of", "json",
    ]);
    cmd.arg(video_path);

    let output = run_command(&mut cmd, "ffprobe extract audio tracks")?;
    let json_str = String::from_utf8_lossy(&output.stdout);

    let parsed: FFprobeOutput = serde_json::from_str(&json_str)
        .map_err(|e| SnipFlowError::ParseError(format!("Invalid ffprobe json: {e}")))?;

    let mut tracks = Vec::new();
    if let Some(streams) = parsed.streams {
        for (track_idx, s) in streams.into_iter().enumerate() {
            let title = s.tags.and_then(|t| {
                t.get("title").and_then(|v| v.as_str().map(|s| s.to_string()))
            });

            tracks.push(AudioStreamInfo {
                stream_index: s.index,
                track_index: track_idx,
                codec: s.codec_name.unwrap_or_else(|| "unknown".to_string()),
                channels: s.channels.unwrap_or(2),
                title,
            });
        }
    }

    Ok(tracks)
}
