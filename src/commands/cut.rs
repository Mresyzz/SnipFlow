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

#[derive(Serialize, Clone, Debug)]
pub struct BatchExportResult {
    pub exported_count: usize,
    pub total_elapsed_ms: f64,
    pub output_dir: String,
    pub clips: Vec<String>,
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

#[command]
pub async fn batch_export_segments_cmd(
    source_path: String,
    segments: Vec<(f64, f64)>,
    output_dir_override: Option<String>,
) -> Result<BatchExportResult, String> {
    tokio::task::spawn_blocking(move || {
        let src = PathBuf::from(&source_path);
        if !src.exists() {
            return Err(format!("Source media not found: {source_path}"));
        }

        let out_dir = match output_dir_override {
            Some(d) => PathBuf::from(d),
            None => {
                let stem = src.file_stem().unwrap_or_default().to_string_lossy();
                src.parent().unwrap_or(PathBuf::from(".").as_path()).join(format!("{stem}_cuts"))
            }
        };

        std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

        let extension = src.extension().unwrap_or_default().to_string_lossy();
        let ext_str = if extension.is_empty() { "mp4" } else { &extension };

        let t0 = std::time::Instant::now();
        let mut created_clips = Vec::new();

        for (idx, (start, end)) in segments.into_iter().enumerate() {
            if end <= start {
                continue;
            }
            let filename = format!("clip_{:03}.{}", idx + 1, ext_str);
            let clip_path = out_dir.join(&filename);

            lossless_cut(&src, start, end, &clip_path).map_err(|e| e.to_string())?;
            created_clips.push(clip_path.to_string_lossy().to_string());
        }

        let total_ms = t0.elapsed().as_secs_f64() * 1000.0;

        Ok(BatchExportResult {
            exported_count: created_clips.len(),
            total_elapsed_ms: total_ms,
            output_dir: out_dir.to_string_lossy().to_string(),
            clips: created_clips,
        })
    })
    .await
    .map_err(|e| format!("Batch cut failed: {e}"))?
}

#[derive(Serialize, Clone, Debug)]
pub struct SeamlessMergeResult {
    pub output_path: String,
    pub total_elapsed_ms: f64,
    pub merged_segments_count: usize,
}

#[command]
pub async fn export_seamless_merge_cmd(
    source_path: String,
    segments: Vec<(f64, f64)>,
    output_path_override: Option<String>,
) -> Result<SeamlessMergeResult, String> {
    tokio::task::spawn_blocking(move || {
        let src = PathBuf::from(&source_path);
        if !src.exists() {
            return Err(format!("Source media not found: {source_path}"));
        }

        let dst = match output_path_override {
            Some(p) => PathBuf::from(p),
            None => {
                let stem = src.file_stem().unwrap_or_default().to_string_lossy();
                let ext = src.extension().unwrap_or_default().to_string_lossy();
                let ext_str = if ext.is_empty() { "mp4" } else { &ext };
                src.parent()
                    .unwrap_or(PathBuf::from(".").as_path())
                    .join(format!("{stem}_seamless_cut.{ext_str}"))
            }
        };

        let t0 = std::time::Instant::now();
        crate::seamless_merge(&src, &segments, &dst).map_err(|e| e.to_string())?;
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;

        Ok(SeamlessMergeResult {
            output_path: dst.to_string_lossy().to_string(),
            total_elapsed_ms: elapsed_ms,
            merged_segments_count: segments.len(),
        })
    })
    .await
    .map_err(|e| format!("Seamless merge failed: {e}"))?
}
