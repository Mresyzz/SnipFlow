use std::path::PathBuf;
use serde::Serialize;
use tauri::command;
use crate::lossless_cut;

#[derive(Serialize, Clone, Debug)]
pub struct CutResult {
    pub output_path: String,
    pub elapsed_ms: f64,
    pub start: f64,
    pub end: f64,
    pub duration: f64,
}

#[command]
pub async fn lossless_cut_cmd(
    source_path: String,
    start: f64,
    end: f64,
    output_path: String,
) -> Result<CutResult, String> {
    tokio::task::spawn_blocking(move || {
        let src = PathBuf::from(&source_path);
        let dst = PathBuf::from(&output_path);

        let t0 = std::time::Instant::now();
        lossless_cut(&src, start, end, &dst).map_err(|e| e.to_string())?;
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;

        Ok(CutResult {
            output_path,
            elapsed_ms,
            start,
            end,
            duration: end - start,
        })
    })
    .await
    .map_err(|e| format!("Cut execution failed: {e}"))?
}
