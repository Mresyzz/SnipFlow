import React, { useRef, useEffect, useState, useCallback } from "react";
import { snapToKeyframe } from "../hooks/useMagneticSnap";

interface TimelineCanvasProps {
  duration: number;
  currentTime: number;
  inPoint: number | null;
  outPoint: number | null;
  keyframes: number[];
  silenceIntervals: [number, number][];
  activeSegments?: [number, number][];
  selectedClipIndex?: number | null;
  peakHighlights: number[];
  waveformPeaks: number[];
  isMagneticSnapEnabled: boolean;
  zoomLevel: number;
  onSeek: (time: number) => void;
  onChangeInPoint?: (time: number) => void;
  onChangeOutPoint?: (time: number) => void;
  onTrimDragStart?: () => void;
  onWheelZoom?: (direction: "in" | "out") => void;
  onDoubleClickTime?: (time: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

type DragTarget = "playhead" | "in" | "out" | null;

export const TimelineCanvas: React.FC<TimelineCanvasProps> = ({
  duration,
  currentTime,
  inPoint,
  outPoint,
  keyframes,
  silenceIntervals,
  activeSegments = [],
  selectedClipIndex = null,
  peakHighlights,
  waveformPeaks,
  isMagneticSnapEnabled,
  zoomLevel,
  onSeek,
  onChangeInPoint,
  onChangeOutPoint,
  onTrimDragStart,
  onWheelZoom,
  onDoubleClickTime,
  onDragStart,
  onDragEnd,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [hoverTarget, setHoverTarget] = useState<"in" | "out" | null>(null);
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
          behavior: dragTarget !== null ? "auto" : "smooth",
        });
      }
    }
  }, [currentTime, zoomLevel, duration, totalWidth, dragTarget]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = totalWidth;
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

    // 1. Monochrome Studio Base
    ctx.fillStyle = "#0d0d10";
    ctx.fillRect(0, 0, width, height);

    // Track separator lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.lineTo(width, 20);
    ctx.moveTo(0, 28);
    ctx.lineTo(width, 28);
    ctx.stroke();

    // 2. Silence Regions (Subtle dark hatched/shaded intervals)
    ctx.fillStyle = "rgba(255, 255, 255, 0.015)";
    for (const [start, end] of silenceIntervals) {
      const x0 = timeToX(start);
      const x1 = timeToX(end);
      ctx.fillRect(x0, 28, Math.max(2, x1 - x0), height - 28);
    }

    // 3. Active Segment Region Overlays
    for (let idx = 0; idx < activeSegments.length; idx++) {
      const [s, e] = activeSegments[idx];
      const x0 = timeToX(s);
      const x1 = timeToX(e);
      const segW = Math.max(2, x1 - x0);
      const isSelected = selectedClipIndex === idx;

      ctx.fillStyle = isSelected
        ? "rgba(255, 255, 255, 0.07)"
        : "rgba(255, 255, 255, 0.025)";
      ctx.fillRect(x0, 30, segW, height - 34);

      ctx.strokeStyle = isSelected
        ? "rgba(255, 255, 255, 0.45)"
        : "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, 30.5, Math.max(1, segW - 1), height - 35);

      if (segW > 26) {
        ctx.fillStyle = isSelected ? "#ffffff" : "#71717a";
        ctx.font = "500 9px 'JetBrains Mono', monospace";
        ctx.fillText(`#${idx + 1}`, x0 + 4, 41);
      }
    }

    // 4. High-Density Audio Waveform Envelope (Adaptive 1200-bin monochrome rendering)
    if (waveformPeaks.length > 0) {
      const binCount = waveformPeaks.length;
      const centerY = 62;
      const maxAmp = 24;
      const targetBars = Math.min(binCount, Math.max(240, Math.floor(width / 2.4)));
      const step = binCount / targetBars;
      const barWidth = width / targetBars;

      const selStart = inPoint !== null && outPoint !== null ? Math.min(inPoint, outPoint) : -1;
      const selEnd = inPoint !== null && outPoint !== null ? Math.max(inPoint, outPoint) : -1;

      for (let i = 0; i < targetBars; i++) {
        const startBin = Math.floor(i * step);
        const endBin = Math.max(startBin + 1, Math.min(binCount, Math.floor((i + 1) * step)));
        let localPeak = 0;
        for (let b = startBin; b < endBin; b++) {
          if (waveformPeaks[b] > localPeak) localPeak = waveformPeaks[b];
        }
        const barTime = ((i + 0.5) / targetBars) * safeDuration;
        const inSelection = barTime >= selStart && barTime <= selEnd;
        const inActiveClip = activeSegments.some(([s, e]) => barTime >= s && barTime <= e);

        ctx.fillStyle = inSelection
          ? "#e4e4e7"
          : inActiveClip
          ? "#71717a"
          : "#27272a";

        const bx = i * barWidth;
        const barHeight = Math.max(2, localPeak * maxAmp * 2);
        ctx.fillRect(bx, centerY - barHeight / 2, Math.max(1, barWidth - 0.8), barHeight);
      }
    }

    // 5. Peak Highlight Markers (Monochrome bright ticks)
    ctx.fillStyle = "#ffffff";
    for (const peak of peakHighlights) {
      const x = timeToX(peak);
      ctx.fillRect(x - 0.75, 78, 1.5, 12);
      ctx.beginPath();
      ctx.arc(x, 78, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. Keyframes (I-frames) on sub-ruler
    ctx.fillStyle = "#a1a1aa";
    let lastKfPx = -10;
    for (const kf of keyframes) {
      const x = timeToX(kf);
      if (Math.abs(x - lastKfPx) < 1.2) continue;
      lastKfPx = x;
      ctx.fillRect(x - 0.5, 21, 1, 6);
    }

    // 7. Timecode Ruler & Ticks (Top 20px)
    ctx.fillStyle = "#111115";
    ctx.fillRect(0, 0, width, 20);

    ctx.strokeStyle = "#3f3f46";
    ctx.lineWidth = 1;
    const baseInterval = duration > 600 ? 60 : duration > 60 ? 10 : 2;
    const tickInterval = Math.max(0.1, baseInterval / zoomLevel);

    let lastLabelX = -100;
    for (let t = 0; t <= duration; t += tickInterval) {
      const x = timeToX(t);
      ctx.beginPath();
      ctx.moveTo(x, 14);
      ctx.lineTo(x, 20);
      ctx.stroke();

      if (x - lastLabelX > 65) {
        ctx.fillStyle = "#71717a";
        ctx.font = "9px 'JetBrains Mono', monospace";
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        const label = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
        ctx.fillText(label, x + 3, 12);
        lastLabelX = x;
      }
    }

    // 8. Pure Monochrome In/Out Selection Mask & Interactive Trim Handles
    if (inPoint !== null && outPoint !== null) {
      const rawInX = timeToX(inPoint);
      const rawOutX = timeToX(outPoint);
      const xIn = Math.min(rawInX, rawOutX);
      const xOut = Math.max(rawInX, rawOutX);

      // Darken outside regions
      ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
      ctx.fillRect(0, 20, xIn, height - 20);
      ctx.fillRect(xOut, 20, width - xOut, height - 20);

      // Selected region active border
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(xIn, 20, Math.max(1, xOut - xIn), height - 20);

      // In-Point Bracket & Grip Handle
      ctx.fillStyle = hoverTarget === "in" || dragTarget === "in" ? "#ffffff" : "#e4e4e7";
      ctx.fillRect(xIn - 1, 18, 2.5, height - 18);
      ctx.fillRect(xIn, 18, 7, 2.5);
      ctx.fillRect(xIn, height - 2.5, 7, 2.5);
      ctx.fillRect(xIn - 2, 48, 5, 18);

      // Out-Point Bracket & Grip Handle
      ctx.fillStyle = hoverTarget === "out" || dragTarget === "out" ? "#ffffff" : "#e4e4e7";
      ctx.fillRect(xOut - 1.5, 18, 2.5, height - 18);
      ctx.fillRect(xOut - 7, 18, 7, 2.5);
      ctx.fillRect(xOut - 7, height - 2.5, 7, 2.5);
      ctx.fillRect(xOut - 3, 48, 5, 18);
    }

    // 9. Hover cursor indicator
    if (hoverTime !== null) {
      const hx = timeToX(hoverTime);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, height);
      ctx.stroke();
    }

    // 10. Pure White Playhead Needle with Top Cap
    const px = timeToX(currentTime);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(px, 5, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }, [
    duration,
    currentTime,
    inPoint,
    outPoint,
    keyframes,
    silenceIntervals,
    activeSegments,
    selectedClipIndex,
    peakHighlights,
    waveformPeaks,
    hoverTime,
    hoverTarget,
    dragTarget,
    zoomLevel,
    totalWidth,
  ]);

  const detectHitTarget = (clientX: number, rect: DOMRect): "in" | "out" | "playhead" => {
    const safeDuration = duration > 0 ? duration : 1;
    const offsetX = clientX - rect.left;
    if (inPoint !== null) {
      const xIn = (inPoint / safeDuration) * rect.width;
      if (Math.abs(offsetX - xIn) <= 7) return "in";
    }
    if (outPoint !== null) {
      const xOut = (outPoint / safeDuration) * rect.width;
      if (Math.abs(offsetX - xOut) <= 7) return "out";
    }
    return "playhead";
  };

  const applyDragAction = (mode: DragTarget, targetTime: number) => {
    if (mode === "in" && onChangeInPoint) {
      const maxIn = outPoint !== null ? Math.max(0, outPoint - 0.1) : duration;
      const clamped = Math.min(targetTime, maxIn);
      onChangeInPoint(clamped);
      onSeek(clamped);
    } else if (mode === "out" && onChangeOutPoint) {
      const minOut = inPoint !== null ? Math.min(duration, inPoint + 0.1) : 0;
      const clamped = Math.max(targetTime, minOut);
      onChangeOutPoint(clamped);
      onSeek(clamped);
    } else {
      onSeek(targetTime);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = detectHitTarget(e.clientX, rect);
    setDragTarget(hit);
    if ((hit === "in" || hit === "out") && onTrimDragStart) {
      onTrimDragStart();
    }
    if (onDragStart) onDragStart();
    e.currentTarget.setPointerCapture(e.pointerId);
    const targetTime = calculateTargetTime(e.clientX, rect);
    applyDragAction(hit, targetTime);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const targetTime = calculateTargetTime(e.clientX, rect);
    setHoverTime(targetTime);

    if (dragTarget !== null) {
      applyDragAction(dragTarget, targetTime);
    } else {
      const hit = detectHitTarget(e.clientX, rect);
      setHoverTarget(hit === "in" || hit === "out" ? hit : null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragTarget !== null) {
      setDragTarget(null);
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (onDragEnd) onDragEnd();
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!onWheelZoom) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      onWheelZoom(e.deltaY < 0 ? "in" : "out");
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onDoubleClickTime) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const targetTime = calculateTargetTime(e.clientX, rect);
    onDoubleClickTime(targetTime);
  };

  return (
    <div
      ref={scrollContainerRef}
      className="w-full relative select-none overflow-x-auto overflow-y-hidden bg-[#0d0d10]"
      title="Drag [ or ] handles to trim · Scroll wheel to zoom · Double-click to select clip under cursor"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onPointerLeave={() => {
          setHoverTime(null);
          setHoverTarget(null);
        }}
        className={`block ${
          hoverTarget !== null || dragTarget === "in" || dragTarget === "out"
            ? "cursor-ew-resize"
            : "cursor-crosshair"
        }`}
      />
    </div>
  );
};
