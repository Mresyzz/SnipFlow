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
      return isMagneticSnapEnabled ? snapToKeyframe(rawTime, keyframes, 0.25 / zoomLevel) : rawTime;
    },
    [duration, isMagneticSnapEnabled, keyframes, zoomLevel]
  );

  // Auto-scroll viewport to track playhead
  useEffect(() => {
    if (zoomLevel > 1 && scrollContainerRef.current && duration > 0) {
      const container = scrollContainerRef.current;
      const playheadX = (currentTime / duration) * totalWidth;
      const scrollLeft = container.scrollLeft;
      const visibleWidth = container.clientWidth;

      if (playheadX < scrollLeft + 30 || playheadX > scrollLeft + visibleWidth - 30) {
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
    const height = 92;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const safeDuration = duration > 0 ? duration : 1;
    const timeToX = (t: number) => (t / safeDuration) * width;

    // 1. Studio Dark Slate Base
    ctx.fillStyle = "#111215";
    ctx.fillRect(0, 0, width, height);

    // Track separator lines
    ctx.strokeStyle = "#1e2025";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.lineTo(width, 20);
    ctx.moveTo(0, 28);
    ctx.lineTo(width, 28);
    ctx.stroke();

    // 2. Audio Waveform (Solid dense bars on track)
    if (waveformPeaks.length > 0) {
      const barCount = waveformPeaks.length;
      const barWidth = Math.max(1, width / barCount);
      const centerY = 58;
      const maxAmp = 24;

      ctx.fillStyle = "#334155"; // Neutral slate audio wave
      for (let i = 0; i < barCount; i++) {
        const peak = waveformPeaks[i];
        const bx = (i / barCount) * width;
        const barHeight = Math.max(1.5, peak * maxAmp);
        ctx.fillRect(bx, centerY - barHeight / 2, Math.max(1, barWidth - 0.5), barHeight);
      }
    }

    // 3. Silence Regions (Clean translucent red warning blocks)
    ctx.fillStyle = "rgba(220, 38, 38, 0.22)";
    for (const [start, end] of silenceIntervals) {
      const x0 = timeToX(start);
      const x1 = timeToX(end);
      ctx.fillRect(x0, 28, Math.max(2, x1 - x0), height - 28);
    }

    // 4. Peak Highlight Markers (Solid subtle gold ticks)
    ctx.fillStyle = "#d97706";
    for (const peak of peakHighlights) {
      const x = timeToX(peak);
      ctx.fillRect(x - 1, 74, 2, 12);
      ctx.beginPath();
      ctx.arc(x, 74, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Keyframes (I-frames) on sub-ruler
    ctx.fillStyle = "#e2e8f0";
    let lastKfPx = -10;
    for (const kf of keyframes) {
      const x = timeToX(kf);
      if (Math.abs(x - lastKfPx) < 1.2) continue;
      lastKfPx = x;
      ctx.fillRect(x - 0.5, 20, 1, 8);
    }

    // 6. Professional In/Out Selection Mask (Dimming unselected zones)
    if (inPoint !== null && outPoint !== null) {
      const rawInX = timeToX(inPoint);
      const rawOutX = timeToX(outPoint);
      const xIn = Math.min(rawInX, rawOutX);
      const xOut = Math.max(rawInX, rawOutX);

      // Darken outside regions
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(0, 0, xIn, height);
      ctx.fillRect(xOut, 0, width - xOut, height);

      // Selected region active border
      ctx.strokeStyle = "rgba(14, 165, 233, 0.8)";
      ctx.lineWidth = 1;
      ctx.strokeRect(xIn, 20, xOut - xIn, height - 20);

      // Boundary brackets [ and ]
      ctx.fillStyle = "#0ea5e9";
      ctx.fillRect(xIn - 1, 0, 2, height);
      ctx.fillRect(xOut - 1, 0, 2, height);
    }

    // 7. Timecode Ruler & Ticks (Top 20px)
    ctx.fillStyle = "#181a1f";
    ctx.fillRect(0, 0, width, 20);

    ctx.strokeStyle = "#3f3f46";
    ctx.lineWidth = 1;
    const baseInterval = duration > 600 ? 60 : duration > 60 ? 10 : 2;
    const tickInterval = Math.max(0.2, baseInterval / zoomLevel);

    let lastLabelX = -100;
    for (let t = 0; t <= duration; t += tickInterval) {
      const x = timeToX(t);
      ctx.beginPath();
      ctx.moveTo(x, 14);
      ctx.lineTo(x, 20);
      ctx.stroke();

      if (x - lastLabelX > 60) {
        ctx.fillStyle = "#71717a";
        ctx.font = "9px monospace";
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        const label = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
        ctx.fillText(label, x + 3, 12);
        lastLabelX = x;
      }
    }

    // 8. Hover cursor indicator
    if (hoverTime !== null) {
      const hx = timeToX(hoverTime);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, height);
      ctx.stroke();
    }

    // 9. Standard NLE Playhead (Orange/Red fine needle with top triangle)
    const px = timeToX(currentTime);
    ctx.strokeStyle = "#f43f5e"; // Professional ruby red playhead
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();

    ctx.fillStyle = "#f43f5e";
    ctx.beginPath();
    ctx.moveTo(px - 4, 0);
    ctx.lineTo(px + 4, 0);
    ctx.lineTo(px, 6);
    ctx.closePath();
    ctx.fill();
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
      className="w-full relative select-none overflow-x-auto overflow-y-hidden rounded border border-zinc-800 bg-zinc-950"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHoverTime(null)}
        className="block cursor-crosshair"
      />
    </div>
  );
};
