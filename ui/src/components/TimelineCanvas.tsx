import React, { useRef, useEffect, useState, useCallback } from "react";
import { snapToKeyframe } from "../hooks/useMagneticSnap";

interface TimelineCanvasProps {
  duration: number;
  currentTime: number;
  inPoint: number | null;
  outPoint: number | null;
  keyframes: number[];
  silenceIntervals: [number, number][];
  isMagneticSnapEnabled: boolean;
  onSeek: (time: number) => void;
}

export const TimelineCanvas: React.FC<TimelineCanvasProps> = ({
  duration,
  currentTime,
  inPoint,
  outPoint,
  keyframes,
  silenceIntervals,
  isMagneticSnapEnabled,
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
      return isMagneticSnapEnabled ? snapToKeyframe(rawTime, keyframes, 0.25) : rawTime;
    },
    [duration, isMagneticSnapEnabled, keyframes]
  );

  // Resize canvas according to device pixel ratio
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

    const timeToX = (t: number) => (t / (duration || 1)) * width;

    // 1. Clear background
    ctx.fillStyle = "#12151e";
    ctx.fillRect(0, 0, width, height);

    // 2. Subtle timeline tick grid
    ctx.strokeStyle = "#1b202c";
    ctx.lineWidth = 1;
    const tickInterval = duration > 600 ? 60 : duration > 60 ? 10 : 2;
    for (let t = 0; t <= duration; t += tickInterval) {
      const x = timeToX(t);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      ctx.fillStyle = "#4a5568";
      ctx.font = "10px monospace";
      ctx.fillText(`${Math.floor(t)}s`, x + 3, 14);
    }

    // 3. Draw Silence Regions (Dead-air highlight)
    ctx.fillStyle = "rgba(255, 8, 68, 0.22)";
    for (const [start, end] of silenceIntervals) {
      const x0 = timeToX(start);
      const x1 = timeToX(end);
      ctx.fillRect(x0, 18, Math.max(2, x1 - x0), height - 24);
    }

    // 4. Draw Keyframe (I-frame) Marks
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1;
    for (const kf of keyframes) {
      const x = timeToX(kf);
      ctx.beginPath();
      ctx.moveTo(x, 18);
      ctx.lineTo(x, 26);
      ctx.stroke();
    }

    // 5. Draw In/Out Cut Selection
    if (inPoint !== null && outPoint !== null) {
      const xIn = timeToX(inPoint);
      const xOut = timeToX(outPoint);
      ctx.fillStyle = "rgba(0, 242, 254, 0.14)";
      ctx.fillRect(xIn, 18, Math.max(2, xOut - xIn), height - 24);
      ctx.strokeStyle = "#00f2fe";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(xIn, 18, Math.max(2, xOut - xIn), height - 24);
    }

    // 6. Draw Hover snap preview indicator
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

    // 7. Draw Active Playhead
    const px = timeToX(currentTime);
    ctx.shadowColor = "#00f2fe";
    ctx.shadowBlur = 8;
    ctx.strokeStyle = "#00f2fe";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();

    // Playhead crown
    ctx.fillStyle = "#00f2fe";
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }, [duration, currentTime, inPoint, outPoint, keyframes, silenceIntervals, hoverTime]);

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
