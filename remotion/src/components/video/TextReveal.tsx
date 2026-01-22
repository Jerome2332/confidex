/**
 * TextReveal Component
 * Typewriter-style text animation for Remotion
 *
 * Features:
 * - Character-by-character reveal
 * - Optional blinking cursor
 * - Configurable speed and delay
 * - Supports multiline text
 */

import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { COLORS, TYPOGRAPHY } from "../../lib/constants";

interface TextRevealProps {
  text: string;
  startFrame?: number;
  charsPerFrame?: number;
  showCursor?: boolean;
  cursorBlinkSpeed?: number;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  onComplete?: () => void;
}

export const TextReveal: React.FC<TextRevealProps> = ({
  text,
  startFrame = 0,
  charsPerFrame = 0.5,
  showCursor = false,
  cursorBlinkSpeed = 0.5,
  fontSize = TYPOGRAPHY.body.size,
  fontWeight = TYPOGRAPHY.body.weight,
  color = COLORS.text.primary,
  className = "",
  style = {},
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Calculate how many characters to show
  const elapsed = Math.max(0, frame - startFrame);
  const charsToShow = Math.min(Math.floor(elapsed * charsPerFrame), text.length);

  // Visible text
  const visibleText = text.slice(0, charsToShow);

  // Cursor blink (on for half cycle, off for half)
  const cursorCycle = (frame * cursorBlinkSpeed) / fps;
  const cursorVisible = showCursor && charsToShow < text.length && Math.sin(cursorCycle * Math.PI * 2) > 0;

  // Completed state - cursor stays solid for a moment then blinks
  const isComplete = charsToShow >= text.length;
  const completeCursorVisible = isComplete && showCursor && Math.sin(cursorCycle * Math.PI * 2) > 0;

  return (
    <span
      className={className}
      style={{
        fontSize,
        fontWeight,
        color,
        fontFamily: "'Inter', system-ui, sans-serif",
        whiteSpace: "pre-wrap",
        ...style,
      }}
    >
      {visibleText}
      {(cursorVisible || completeCursorVisible) && (
        <span
          style={{
            display: "inline-block",
            width: "2px",
            height: "1em",
            backgroundColor: color,
            marginLeft: "2px",
            verticalAlign: "text-bottom",
          }}
        />
      )}
    </span>
  );
};

/**
 * Word-by-word reveal with fade effect
 */
interface WordRevealProps {
  text: string;
  startFrame?: number;
  framesPerWord?: number;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  highlightColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const WordReveal: React.FC<WordRevealProps> = ({
  text,
  startFrame = 0,
  framesPerWord = 6,
  fontSize = TYPOGRAPHY.body.size,
  fontWeight = TYPOGRAPHY.body.weight,
  color = COLORS.text.primary,
  highlightColor = COLORS.accent.privacy.full,
  className = "",
  style = {},
}) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");

  return (
    <span
      className={className}
      style={{
        fontSize,
        fontWeight,
        fontFamily: "'Inter', system-ui, sans-serif",
        ...style,
      }}
    >
      {words.map((word, index) => {
        const wordStartFrame = startFrame + index * framesPerWord;
        const progress = interpolate(
          frame,
          [wordStartFrame, wordStartFrame + framesPerWord],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        const opacity = interpolate(progress, [0, 0.5], [0, 1], {
          extrapolateRight: "clamp",
        });

        const isCurrentWord =
          frame >= wordStartFrame && frame < wordStartFrame + framesPerWord * 2;

        return (
          <span
            key={index}
            style={{
              opacity,
              color: isCurrentWord ? highlightColor : color,
              transition: "color 0.1s",
            }}
          >
            {word}
            {index < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </span>
  );
};

/**
 * Line-by-line reveal for multi-line text
 */
interface LineRevealProps {
  lines: string[];
  startFrame?: number;
  framesPerLine?: number;
  staggerDelay?: number;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  lineHeight?: number;
  className?: string;
}

export const LineReveal: React.FC<LineRevealProps> = ({
  lines,
  startFrame = 0,
  framesPerLine = 20,
  staggerDelay = 10,
  fontSize = TYPOGRAPHY.body.size,
  fontWeight = TYPOGRAPHY.body.weight,
  color = COLORS.text.primary,
  lineHeight = 1.5,
  className = "",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      className={className}
      style={{
        fontSize,
        fontWeight,
        color,
        fontFamily: "'Inter', system-ui, sans-serif",
        lineHeight,
      }}
    >
      {lines.map((line, index) => {
        const lineStartFrame = startFrame + index * staggerDelay;
        const progress = interpolate(
          frame,
          [lineStartFrame, lineStartFrame + framesPerLine],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        const opacity = interpolate(progress, [0, 0.3], [0, 1], {
          extrapolateRight: "clamp",
        });

        const translateY = interpolate(progress, [0, 1], [20, 0], {
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={index}
            style={{
              opacity,
              transform: `translateY(${translateY}px)`,
            }}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
};

export default TextReveal;
