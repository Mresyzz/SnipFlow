use std::path::PathBuf;
use serde::Serialize;
use tauri::command;
use snipflow::{
    export_cmx3600_edl, export_fcpxml, lossless_cut_with_mode, seamless_merge_with_mode, CutMode,
};

#[derive(Serialize, Clone, Debug)]
pub struct CutResult {
    pub output_path: String,
    pub elapsed_ms: f64,
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    pub mode: CutMode,
}

#[derive(Serialize, Clone, Debug)]
pub struct BatchExportResult {
    pub exported_count: usize,
    pub total_elapsed_ms: f64,
    pub output_dir: String,
    pub clips: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct NleExportResult {
    pub edl_path: String,
    pub fcpxml_path: String,
    pub events_count: usize,
}

#[command]
pub async fn lossless_cut_cmd(
    source_path: String,
    start: f64,
    end: f64,
    output_path: String,
    cut_mode: Option<CutMode>,
) -> Result<CutResult, String> {
    tokio::task::spawn_blocking(move || {
        let src = PathBuf::from(&source_path);
        let dst = PathBuf::from(&output_path);
        let mode = cut_mode.unwrap_or_default();

        let t0 = std::time::Instant::now();
        lossless_cut_with_mode(&src, start, end, &dst, mode).map_err(|e| e.to_string())?;
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;

        Ok(CutResult {
            output_path,
            elapsed_ms,
            start,
            end,
            duration: end - start,
            mode,
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
    cut_mode: Option<CutMode>,
    container_format: Option<String>,
) -> Result<BatchExportResult, String> {
    tokio::task::spawn_blocking(move || {
        let src = PathBuf::from(&source_path);
        if !src.exists() {
            return Err(format!("Source media not found: {source_path}"));
        }

        let mode = cut_mode.unwrap_or_default();
        let out_dir = match output_dir_override {
            Some(d) => PathBuf::from(d),
            None => {
                let stem = src.file_stem().unwrap_or_default().to_string_lossy();
                src.parent().unwrap_or(PathBuf::from(".").as_path()).join(format!("{stem}_cuts"))
            }
        };

        std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

        let src_ext = src.extension().unwrap_or_default().to_string_lossy().to_string();
        let ext_str = match container_format.as_deref() {
            Some("mp4" | "mkv" | "mov") => container_format.unwrap(),
            _ if !src_ext.is_empty() => src_ext,
            _ => "mp4".to_string(),
        };

        let t0 = std::time::Instant::now();
        let mut created_clips = Vec::new();

        for (idx, (start, end)) in segments.into_iter().enumerate() {
            if end <= start {
                continue;
            }
            let filename = format!("clip_{:03}.{}", idx + 1, ext_str);
            let clip_path = out_dir.join(&filename);

            lossless_cut_with_mode(&src, start, end, &clip_path, mode).map_err(|e| e.to_string())?;
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
    cut_mode: Option<CutMode>,
) -> Result<SeamlessMergeResult, String> {
    tokio::task::spawn_blocking(move || {
        let src = PathBuf::from(&source_path);
        if !src.exists() {
            return Err(format!("Source media not found: {source_path}"));
        }

        let mode = cut_mode.unwrap_or_default();
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
        seamless_merge_with_mode(&src, &segments, &dst, mode).map_err(|e| e.to_string())?;
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

#[command]
pub async fn export_nle_timeline_cmd(
    source_path: String,
    segments: Vec<(f64, f64)>,
    total_duration: f64,
    output_dir_override: Option<String>,
) -> Result<NleExportResult, String> {
    tokio::task::spawn_blocking(move || {
        let src = PathBuf::from(&source_path);
        if !src.exists() {
            return Err(format!("Source media not found: {source_path}"));
        }

        let stem = src.file_stem().unwrap_or_default().to_string_lossy();
        let out_dir = match output_dir_override {
            Some(d) => PathBuf::from(d),
            None => src.parent().unwrap_or(PathBuf::from(".").as_path()).to_path_buf(),
        };

        std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

        let edl_path = out_dir.join(format!("{stem}_timeline.edl"));
        let fcpxml_path = out_dir.join(format!("{stem}_timeline.fcpxml"));

        export_cmx3600_edl(&src, &segments, 30, &edl_path).map_err(|e| e.to_string())?;
        export_fcpxml(&src, &segments, total_duration, &fcpxml_path).map_err(|e| e.to_string())?;

        Ok(NleExportResult {
            edl_path: edl_path.to_string_lossy().to_string(),
            fcpxml_path: fcpxml_path.to_string_lossy().to_string(),
            events_count: segments.len(),
        })
    })
    .await
    .map_err(|e| format!("NLE timeline export failed: {e}"))?
}
