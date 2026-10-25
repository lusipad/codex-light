import React, { useEffect, useRef, useState } from "react";

export type PetAnimationState =
  | "idle"
  | "running"
  | "running-left"
  | "running-right"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "review";

export interface PetSpriteProps {
  spritesheetUrl?: string | null;
  spriteVersionNumber?: number;
  state?: PetAnimationState;
  size?: number; // width in px, height = Math.round(size * (208 / 192))
  respondToHover?: boolean;
  trackCursor?: boolean;
  className?: string;
  style?: React.CSSProperties;
  fallbackEmoji?: string;
  onClick?: (e: React.MouseEvent) => void;
}

// Official Codex App animation row mapping & frame specifications
// (Extracted from app-initial-fd3c4b862660.js)
interface RowConfig {
  row: number;
  frameCount: number;
  durations: number[];
  loop: boolean;
}

const ROW_CONFIGS: Record<PetAnimationState, RowConfig> = {
  idle: {
    row: 0,
    frameCount: 6,
    durations: [1680, 660, 660, 840, 840, 1920],
    loop: true,
  },
  "running-right": {
    row: 1,
    frameCount: 8,
    durations: [120, 120, 120, 120, 120, 120, 120, 220],
    loop: true,
  },
  "running-left": {
    row: 2,
    frameCount: 8,
    durations: [120, 120, 120, 120, 120, 120, 120, 220],
    loop: true,
  },
  waving: {
    row: 3,
    frameCount: 4,
    durations: [140, 140, 140, 280],
    loop: true,
  },
  jumping: {
    row: 4,
    frameCount: 5,
    durations: [140, 140, 140, 140, 280],
    loop: false,
  },
  failed: {
    row: 5,
    frameCount: 8,
    durations: [140, 140, 140, 140, 140, 140, 140, 240],
    loop: false,
  },
  waiting: {
    row: 6,
    frameCount: 6,
    durations: [150, 150, 150, 150, 150, 260],
    loop: true,
  },
  running: {
    row: 7,
    frameCount: 6,
    durations: [120, 120, 120, 120, 120, 220],
    loop: true,
  },
  review: {
    row: 8,
    frameCount: 6,
    durations: [150, 150, 150, 150, 150, 280],
    loop: true,
  },
};

export const PetSprite: React.FC<PetSpriteProps> = ({
  spritesheetUrl,
  spriteVersionNumber = 2,
  state = "idle",
  size = 48,
  respondToHover = true,
  trackCursor = false,
  className = "",
  style = {},
  fallbackEmoji = "🐾",
  onClick,
}) => {
  const [colIndex, setColIndex] = useState(0);
  const [activeRow, setActiveRow] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [cursorLookFrame, setCursorLookFrame] = useState<{
    row: number;
    col: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  const resolvedState: PetAnimationState =
    respondToHover && isHovered && state === "idle" ? "jumping" : state;

  const totalCols = 8;
  const totalRows = spriteVersionNumber === 2 ? 11 : 9;

  // Track cursor angle when idle (rows 9 & 10, 16 directional frames)
  useEffect(() => {
    if (!trackCursor || spriteVersionNumber < 2 || resolvedState !== "idle" || isHovered) {
      setCursorLookFrame(null);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;
      const dist = Math.hypot(dx, dy);

      // Only track if cursor is within 400px
      if (dist < 400 && dist > 15) {
        const angle = (Math.atan2(dx, -dy) * (180 / Math.PI) + 360) % 360; // 0 = up
        const dirIndex = Math.round(angle / 22.5) % 16;
        setCursorLookFrame({
          row: 9 + Math.floor(dirIndex / 8),
          col: dirIndex % 8,
        });
      } else {
        setCursorLookFrame(null);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [trackCursor, spriteVersionNumber, resolvedState, isHovered]);

  // Frame animation loop
  useEffect(() => {
    if (!spritesheetUrl) return;

    if (cursorLookFrame) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setActiveRow(cursorLookFrame.row);
      setColIndex(cursorLookFrame.col);
      return;
    }

    const cfg = ROW_CONFIGS[resolvedState] || ROW_CONFIGS.idle;
    setActiveRow(cfg.row);

    let frame = 0;
    setColIndex(0);

    const step = () => {
      const dur = cfg.durations[frame] || 150;
      timerRef.current = window.setTimeout(() => {
        if (frame + 1 < cfg.frameCount) {
          frame += 1;
          setColIndex(frame);
          step();
        } else if (cfg.loop) {
          frame = 0;
          setColIndex(0);
          step();
        } else if (resolvedState === "jumping" && isHovered) {
          // hold last jumping frame while hovered
          setColIndex(cfg.frameCount - 1);
        }
      }, dur);
    };

    step();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [spritesheetUrl, resolvedState, isHovered, cursorLookFrame]);

  const height = Math.round(size * (208 / 192));

  if (!spritesheetUrl) {
    return (
      <div
        ref={containerRef}
        className={`pet-sprite-fallback ${className}`}
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.round(size * 0.55),
          userSelect: "none",
          ...style,
        }}
        onClick={onClick}
      >
        {fallbackEmoji}
      </div>
    );
  }

  // Calculate background position percentages
  const bgPosX = (colIndex / (totalCols - 1)) * 100;
  const bgPosY = (activeRow / (totalRows - 1)) * 100;

  return (
    <div
      ref={containerRef}
      className={`pet-sprite-container ${className}`}
      style={{
        width: size,
        height,
        backgroundImage: `url("${spritesheetUrl}")`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${totalCols * 100}% ${totalRows * 100}%`,
        backgroundPosition: `${bgPosX}% ${bgPosY}%`,
        imageRendering: "pixelated",
        userSelect: "none",
        ...style,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    />
  );
};
