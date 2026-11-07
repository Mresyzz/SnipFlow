import { useEffect } from "react";

interface ShortcutActions {
  togglePlay: () => void;
  markIn: () => void;
  markOut: () => void;
  triggerExport: () => void;
  onNextHighlight?: () => void;
  stepFrameForward?: () => void;
  stepFrameBackward?: () => void;
}

export function useShortcuts({
  togglePlay,
  markIn,
  markOut,
  triggerExport,
  onNextHighlight,
  stepFrameForward,
  stepFrameBackward,
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

      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlay();
          break;
        case "KeyI":
          e.preventDefault();
          markIn();
          break;
        case "KeyO":
          e.preventDefault();
          markOut();
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
          if (stepFrameForward) {
            e.preventDefault();
            stepFrameForward();
          }
          break;
        case "ArrowLeft":
          if (stepFrameBackward) {
            e.preventDefault();
            stepFrameBackward();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, markIn, markOut, triggerExport, onNextHighlight, stepFrameForward, stepFrameBackward]);
}
