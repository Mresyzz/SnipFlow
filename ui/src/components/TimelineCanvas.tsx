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
  isMagneticSnapEnabled,
  zoomLevel,
  onSeek,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const calculateTargetTime = useCallback(
    (clientX: number, rect: DOMRect) => {
      const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const rawTime = (offsetX / rect.width) * duration;
      return isMagneticSnapEnabled ? snapToKeyframe(rawTime, keyframes, 0.25 / zoomLevel) : rawTime;
    },
    [duration, isMagneticSnapEnabled, keyframes, zoomLevel]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = 96;

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
    ctx.fillStyle = "#12151e";
    ctx.fillRect(0, 0, width, height);

    // 2. Timeline Grid & Dynamic Time Labels
    ctx.strokeStyle = "#1b202c";
    ctx.lineWidth = 1;
    const baseInterval = duration > 600 ? 60 : duration > 60 ? 10 : 2;
    const tickInterval = Math.max(0.5, baseInterval / zoomLevel);

    let lastLabelX = -100;
    for (let t = 0; t <= duration; t += tickInterval) {
      const x = timeToX(t);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      if (x - lastLabelX > 45) {
        ctx.fillStyle = "#4a5568";
        ctx.font = "10px monospace";
        ctx.fillText(`${t.toFixed(t % 1 !== 0 ? 1 : 0)}s`, x + 3, 14);
        lastLabelX = x;
      }
    }

    // 3. Draw Silence Regions (Translucent warning strips)
    ctx.fillStyle = "rgba(255, 8, 68, 0.22)";
    for (const [start, end] of silenceIntervals) {
      const x0 = timeToX(start);
      const x1 = timeToX(end);
      ctx.fillRect(x0, 18, Math.max(2, x1 - x0), height - 24);
    }

    // 4. Draw Peak Highlight Markers (Gold/Amber Neon Indicators)
    ctx.shadowColor = "#f59e0b";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "#f59e0b";
    for (const peak of peakHighlights) {
      const x = timeToX(peak);
      ctx.beginPath();
      ctx.arc(x, 54, 3, 0, Math.PI * 2);
      ctx.fill();

      // Flag needle
      ctx.strokeStyle = "rgba(245, 158, 11, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 48);
      ctx.lineTo(x, 62);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // 5. Draw Keyframe (I-frame) Marks with High-Performance Pixel Decimation
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1;
    let lastKfPx = -10;
    for (const kf of keyframes) {
      const x = timeToX(kf);
      if (Math.abs(x - lastKfPx) < 1.5) continue;
      lastKfPx = x;

      ctx.beginPath();
      ctx.moveTo(x, 18);
      ctx.lineTo(x, 26);
      ctx.stroke();
    }

    // 6. Draw In/Out Cut Selection (Cyan highlighted zone)
    if (inPoint !== null && outPoint !== null) {
      const xIn = timeToX(inPoint);
      const xOut = timeToX(outPoint);
      const selWidth = Math.max(2, xOut - xIn);

      ctx.fillStyle = "rgba(0, 242, 254, 0.14)";
      ctx.fillRect(xIn, 18, selWidth, height - 24);
      ctx.strokeStyle = "#00f2fe";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(xIn, 18, selWidth, height - 24);

      ctx.fillStyle = "#00f2fe";
      ctx.fillRect(xIn - 2, 18, 4, height - 24);
      ctx.fillRect(xOut - 2, 18, 4, height - 24);
    }

    // 7. Draw Hover snap indicator
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

    // 8. Draw Active Playhead with Neon Cyan Glow
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
  }, [duration, currentTime, inPoint, outPoint, keyframes, silenceIntervals, peakHighlights, hoverTime, zoomLevel]);

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
    <div ref={containerRef} className="w-full relative select-none">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHoverTime(null)}
        className="w-full h-24 rounded-lg border border-dark-800 cursor-crosshair shadow-inner"
      />
    </div>
  );
};
