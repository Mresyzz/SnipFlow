import { useEffect } from "react";

interface ShortcutActions {
  togglePlay: () => void;
  markIn: () => void;
  markOut: () => void;
  triggerExport: () => void;
  onNextHighlight?: () => void;
  stepFrameForward?: () => void;
  stepFrameBackward?: () => void;
  seekPrevKeyframe?: () => void;
  seekNextKeyframe?: () => void;
  sliceAtPlayhead?: () => void;
  toggleSkipSilencePreview?: () => void;
  cyclePlaybackSpeed?: () => void;
  rewindShuttle?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  undo?: () => void;
  redo?: () => void;
  openFile?: () => void;
}

export function useShortcuts({
  togglePlay,
  markIn,
  markOut,
  triggerExport,
  onNextHighlight,
  stepFrameForward,
  stepFrameBackward,
  seekPrevKeyframe,
  seekNextKeyframe,
  sliceAtPlayhead,
  toggleSkipSilencePreview,
  cyclePlaybackSpeed,
  rewindShuttle,
  zoomIn,
  zoomOut,
  undo,
  redo,
  openFile,
}: ShortcutActions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey && redo) {
          redo();
        } else if (undo) {
          undo();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
        if (redo) {
          e.preventDefault();
          redo();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.code === "KeyO") {
        if (openFile) {
          e.preventDefault();
          openFile();
        }
        return;
      }

      switch (e.code) {
        case "Space":
        case "KeyK":
          e.preventDefault();
          togglePlay();
          break;
        case "KeyJ":
          if (rewindShuttle) {
            e.preventDefault();
            rewindShuttle();
          }
          break;
        case "KeyL":
          if (cyclePlaybackSpeed) {
            e.preventDefault();
            cyclePlaybackSpeed();
          }
          break;
        case "KeyI":
          e.preventDefault();
          markIn();
          break;
        case "KeyO":
          e.preventDefault();
          markOut();
          break;
        case "KeyX":
          if (sliceAtPlayhead) {
            e.preventDefault();
            sliceAtPlayhead();
          }
          break;
        case "KeyS":
          if (toggleSkipSilencePreview) {
            e.preventDefault();
            toggleSkipSilencePreview();
          }
          break;
        case "KeyH":
          if (onNextHighlight) {
            e.preventDefault();
            onNextHighlight();
          }
          break;
        case "Enter":
          e.preventDefault();
          triggerExport();
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey && seekNextKeyframe) {
            seekNextKeyframe();
          } else if (stepFrameForward) {
            stepFrameForward();
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey && seekPrevKeyframe) {
            seekPrevKeyframe();
          } else if (stepFrameBackward) {
            stepFrameBackward();
          }
          break;
        case "Equal":
          if (zoomIn) {
            e.preventDefault();
            zoomIn();
          }
          break;
        case "Minus":
          if (zoomOut) {
            e.preventDefault();
            zoomOut();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    togglePlay,
    markIn,
    markOut,
    triggerExport,
    onNextHighlight,
    stepFrameForward,
    stepFrameBackward,
    seekPrevKeyframe,
    seekNextKeyframe,
    sliceAtPlayhead,
    toggleSkipSilencePreview,
    cyclePlaybackSpeed,
    rewindShuttle,
    zoomIn,
    zoomOut,
    undo,
    redo,
    openFile,
  ]);
}
