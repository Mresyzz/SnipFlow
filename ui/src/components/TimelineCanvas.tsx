import React, { useRef, useEffect, useState, useCallback } from "react";
import { snapToKeyframe } from "../hooks/useMagneticSnap";

interface TimelineCanvasProps {
  duration: number;
  currentTime: number;
  inPoint: number | null;
  outPoint: number | null;
  keyframes: number[];
  silenceIntervals: [number, number][];
  peakHighlights: number[];
  waveformPeaks: number[];
  isMagneticSnapEnabled: boolean;
  zoomLevel: number;
  onSeek: (time: number) => void;
}

export const TimelineCanvas: React.FC<TimelineCanvasProps> = ({
  duration,
  currentTime,
  inPoint,
  outPoint,
  keyframes,
  silenceIntervals,
  peakHighlights,
  waveformPeaks,
  isMagneticSnapEnabled,
  zoomLevel,
  onSeek,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [containerBaseWidth, setContainerBaseWidth] = useState<number>(1000);

  // Measure base container width
  useEffect(() => {
    const updateSize = () => {
      if (scrollContainerRef.current) {
        setContainerBaseWidth(scrollContainerRef.current.clientWidth);
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const totalWidth = Math.max(containerBaseWidth, Math.round(containerBaseWidth * zoomLevel));

  const calculateTargetTime = useCallback(
    (clientX: number, rect: DOMRect) => {
      const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const rawTime = (offsetX / rect.width) * (duration > 0 ? duration : 1);
      return isMagneticSnapEnabled ? snapToKeyframe(rawTime, keyframes, 0.3 / zoomLevel) : rawTime;
    },
    [duration, isMagneticSnapEnabled, keyframes, zoomLevel]
  );

  // Auto-scroll viewport to keep playhead visible when zoomed in
  useEffect(() => {
    if (zoomLevel > 1 && scrollContainerRef.current && duration > 0) {
      const container = scrollContainerRef.current;
      const playheadX = (currentTime / duration) * totalWidth;
      const scrollLeft = container.scrollLeft;
      const visibleWidth = container.clientWidth;

      if (playheadX < scrollLeft + 40 || playheadX > scrollLeft + visibleWidth - 40) {
        container.scrollTo({
          left: Math.max(0, playheadX - visibleWidth / 2),
          behavior: isDragging ? "auto" : "smooth",
        });
      }
    }
  }, [currentTime, zoomLevel, duration, totalWidth, isDragging]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = totalWidth;
    const height = 104;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const safeDuration = duration > 0 ? duration : 1;
    const timeToX = (t: number) => (t / safeDuration) * width;

    // 1. Dark Base Background
    ctx.fillStyle = "#0e111a";
    ctx.fillRect(0, 0, width, height);

    // 2. Timeline Grid & Dynamic Time Labels
    ctx.strokeStyle = "#1a1f2c";
    ctx.lineWidth = 1;
    const baseInterval = duration > 600 ? 60 : duration > 60 ? 10 : 2;
    const tickInterval = Math.max(0.2, baseInterval / zoomLevel);

    let lastLabelX = -100;
    for (let t = 0; t <= duration; t += tickInterval) {
      const x = timeToX(t);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      if (x - lastLabelX > 50) {
        ctx.fillStyle = "#64748b";
        ctx.font = "10px monospace";
        ctx.fillText(`${t.toFixed(t % 1 !== 0 ? 1 : 0)}s`, x + 3, 14);
        lastLabelX = x;
      }
    }

    // 3. Draw Audio RMS Waveform Peaks (Mirror visual bars)
    if (waveformPeaks.length > 0) {
      const barCount = waveformPeaks.length;
      const barWidth = Math.max(1.5, width / barCount);
      const centerY = 56;
      const maxAmplitude = 26;

      ctx.fillStyle = "rgba(6, 182, 212, 0.45)"; // Cyan waveform glow
      for (let i = 0; i < barCount; i++) {
        const peak = waveformPeaks[i];
        const bx = (i / barCount) * width;
        const barHeight = Math.max(2, peak * maxAmplitude);

        // Render mirrored amplitude bar
        ctx.fillRect(bx, centerY - barHeight / 2, Math.max(1, barWidth - 1), barHeight);
      }
    }

    // 4. Draw Silence Regions (Translucent red warning alert blocks)
    ctx.fillStyle = "rgba(239, 68, 68, 0.28)";
    for (const [start, end] of silenceIntervals) {
      const x0 = timeToX(start);
      const x1 = timeToX(end);
      ctx.fillRect(x0, 20, Math.max(2, x1 - x0), height - 28);
    }

    // 5. Draw Peak Highlight Markers (Gold/Amber Neon Indicators)
    ctx.shadowColor = "#f59e0b";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "#f59e0b";
    for (const peak of peakHighlights) {
      const x = timeToX(peak);
      ctx.beginPath();
      ctx.arc(x, 78, 3, 0, Math.PI * 2);
      ctx.fill();

      // Flag needle
      ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 72);
      ctx.lineTo(x, 86);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // 6. Draw Keyframe (I-frame) Marks with High-Performance Pixel Decimation
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    let lastKfPx = -10;
    for (const kf of keyframes) {
      const x = timeToX(kf);
      if (Math.abs(x - lastKfPx) < 1.2) continue;
      lastKfPx = x;

      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, 28);
      ctx.stroke();
    }

    // 7. Draw In/Out Cut Selection with Inverted Coordinate Normalization
    if (inPoint !== null && outPoint !== null) {
      const rawInX = timeToX(inPoint);
      const rawOutX = timeToX(outPoint);
      const xIn = Math.min(rawInX, rawOutX);
      const xOut = Math.max(rawInX, rawOutX);
      const selWidth = Math.max(2, xOut - xIn);

      ctx.fillStyle = "rgba(0, 242, 254, 0.16)";
      ctx.fillRect(xIn, 20, selWidth, height - 28);
      ctx.strokeStyle = "#00f2fe";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(xIn, 20, selWidth, height - 28);

      // Boundary grip handles
      ctx.fillStyle = "#00f2fe";
      ctx.fillRect(xIn - 2, 20, 4, height - 28);
      ctx.fillRect(xOut - 2, 20, 4, height - 28);
    }

    // 8. Draw Hover snap dashed indicator
    if (hoverTime !== null) {
      const hx = timeToX(hoverTime);
      ctx.strokeStyle = "rgba(0, 242, 254, 0.4)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 9. Draw Active Playhead with Neon Cyan Needle
    const px = timeToX(currentTime);
    ctx.shadowColor = "#00f2fe";
    ctx.shadowBlur = 8;
    ctx.strokeStyle = "#00f2fe";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();

    ctx.fillStyle = "#00f2fe";
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }, [
    duration,
    currentTime,
    inPoint,
    outPoint,
    keyframes,
    silenceIntervals,
    peakHighlights,
    waveformPeaks,
    hoverTime,
    zoomLevel,
    totalWidth,
  ]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(calculateTargetTime(e.clientX, rect));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const target = calculateTargetTime(e.clientX, rect);
    setHoverTime(target);
    if (isDragging) {
      onSeek(target);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      setIsDragging(false);
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      ref={scrollContainerRef}
      className="w-full relative select-none overflow-x-auto overflow-y-hidden rounded-lg border border-dark-800 bg-dark-950/60 custom-scrollbar"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHoverTime(null)}
        className="block cursor-crosshair shadow-inner"
      />
    </div>
  );
};
