use std::path::PathBuf;
use thiserror::Error;

pub type Result<T> = std::result::Result<T, SnipFlowError>;

#[derive(Error, Debug)]
pub enum SnipFlowError {
    #[error("Required multimedia binary '{binary}' was not found in PATH or environment variables")]
    BinaryNotFound { binary: String },

    #[error("File not found at specified path: {0}")]
    FileNotFound(PathBuf),

    #[error("Invalid time interval: start ({start:.3}s) must be strictly non-negative and less than end ({end:.3}s)")]
    InvalidTimeRange { start: f64, end: f64 },

    #[error("Failed to execute external command '{command}' (exit code: {exit_code:?}):\n{stderr}")]
    CommandExecutionFailed {
        command: String,
        exit_code: Option<i32>,
        stderr: String,
    },

    #[error("Output parsing failed: {0}")]
    ParseError(String),

    #[error("I/O error encountered: {0}")]
    Io(#[from] std::io::Error),
}
