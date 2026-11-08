use std::path::Path;
use crate::error::{Result, SnipFlowError};

/// Converts seconds into standard SMPTE non-drop timecode `HH:MM:SS:FF`.
pub fn seconds_to_smpte(sec: f64, fps: u32) -> String {
    let safe_fps = fps.max(1);
    let total_frames = (sec.max(0.0) * (safe_fps as f64)).round() as u64;
    let ff = total_frames % (safe_fps as u64);
    let total_seconds = total_frames / (safe_fps as u64);
    let ss = total_seconds % 60;
    let mm = (total_seconds / 60) % 60;
    let hh = total_seconds / 3600;

    format!("{hh:02}:{mm:02}:{ss:02}:{ff:02}")
}

/// Generates an industry-standard CMX 3600 Edit Decision List (`.edl`) string
/// compatible with DaVinci Resolve, Adobe Premiere Pro, and Avid Media Composer.
pub fn generate_cmx3600_edl_string(
    clip_name: &str,
    segments: &[(f64, f64)],
    fps: u32,
) -> String {
    let safe_fps = fps.max(1);
    let mut lines = Vec::new();
    lines.push(format!("TITLE: SnipFlow_{}", clip_name.replace(' ', "_")));
    lines.push("FCM: NON-DROP FRAME".to_string());
    lines.push(String::new());

    let mut record_timeline_pos = 0.0_f64;

    for (idx, &(src_in, src_out)) in segments.iter().enumerate() {
        if src_out <= src_in {
            continue;
        }
        let seg_dur = src_out - src_in;
        let rec_in = record_timeline_pos;
        let rec_out = record_timeline_pos + seg_dur;

        let event_num = format!("{:03}", (idx + 1).min(999));
        let tc_src_in = seconds_to_smpte(src_in, safe_fps);
        let tc_src_out = seconds_to_smpte(src_out, safe_fps);
        let tc_rec_in = seconds_to_smpte(rec_in, safe_fps);
        let tc_rec_out = seconds_to_smpte(rec_out, safe_fps);

        lines.push(format!(
            "{event_num}  AX       AA/V  C        {tc_src_in} {tc_src_out} {tc_rec_in} {tc_rec_out}"
        ));
        lines.push(format!("* FROM CLIP NAME: {clip_name}"));
        lines.push(String::new());

        record_timeline_pos = rec_out;
    }

    lines.join("\n")
}

/// Exports active segments as a CMX 3600 `.edl` timeline project file.
pub fn export_cmx3600_edl(
    video_path: &Path,
    segments: &[(f64, f64)],
    fps: u32,
    output_edl_path: &Path,
) -> Result<()> {
    if segments.is_empty() {
        return Err(SnipFlowError::InvalidTimeRange { start: 0.0, end: 0.0 });
    }

    if let Some(parent) = output_edl_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let clip_name = video_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "source.mp4".to_string());

    let content = generate_cmx3600_edl_string(&clip_name, segments, fps);
    std::fs::write(output_edl_path, content)?;
    Ok(())
}

/// Generates an FCPXML v1.9 timeline string compatible with Final Cut Pro, DaVinci Resolve, and Premiere.
pub fn generate_fcpxml_string(
    video_path: &Path,
    segments: &[(f64, f64)],
    total_duration: f64,
) -> String {
    let clip_name = video_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "source.mp4".to_string());

    let raw_path = video_path.to_string_lossy().replace('\\', "/");
    let file_uri = if raw_path.starts_with('/') {
        format!("file://{raw_path}")
    } else {
        format!("file:///{raw_path}")
    };

    let total_kept: f64 = segments.iter().map(|(s, e)| (e - s).max(0.0)).sum();
    let total_ms = (total_duration.max(1.0) * 1000.0).round() as u64;
    let kept_ms = (total_kept.max(0.1) * 1000.0).round() as u64;

    let mut spine_items = Vec::new();
    let mut offset_ms: u64 = 0;

    for &(s, e) in segments {
        if e <= s {
            continue;
        }
        let start_ms = (s * 1000.0).round() as u64;
        let dur_ms = ((e - s) * 1000.0).round() as u64;

        spine_items.push(format!(
            "            <asset-clip name=\"{clip_name}\" ref=\"r2\" offset=\"{offset_ms}/1000s\" start=\"{start_ms}/1000s\" duration=\"{dur_ms}/1000s\" />"
        ));
        offset_ms += dur_ms;
    }

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat1080p30" frameDuration="100/3000s" width="1920" height="1080" />
    <asset id="r2" name="{clip_name}" src="{file_uri}" start="0s" duration="{total_ms}/1000s" hasVideo="1" hasAudio="1" format="r1" />
  </resources>
  <library>
    <event name="SnipFlow Rough Cut">
      <project name="SnipFlow_{clip_name}">
        <sequence format="r1" duration="{kept_ms}/1000s">
          <spine>
{}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
"#,
        spine_items.join("\n")
    )
}

/// Exports active segments as an FCPXML v1.9 (`.fcpxml`) timeline file.
pub fn export_fcpxml(
    video_path: &Path,
    segments: &[(f64, f64)],
    total_duration: f64,
    output_xml_path: &Path,
) -> Result<()> {
    if segments.is_empty() {
        return Err(SnipFlowError::InvalidTimeRange { start: 0.0, end: 0.0 });
    }

    if let Some(parent) = output_xml_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let xml = generate_fcpxml_string(video_path, segments, total_duration);
    std::fs::write(output_xml_path, xml)?;
    Ok(())
}
