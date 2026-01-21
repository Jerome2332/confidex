/**
 * ProblemScene
 * Shows the problems with current DEXes
 *
 * Timeline (210 frames / 7 seconds @ 30fps):
 * - 0-30: "The Problem" title slide in
 * - 30-90: Three problem cards stagger entrance
 * - 90-150: Cards highlight with subtle red border
 * - 150-210: Fade out
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  AbsoluteFill,
} from "remotion";
import { Robot, Clock, Eye, Warning } from "@phosphor-icons/react";
import { COLORS, SPRINGS, TYPOGRAPHY, PROBLEMS } from "../lib/constants";

const ICONS = {
  Robot: Robot,
  Clock: Clock,
  Eye: Eye,
};

export const ProblemScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Title animation
  const titleEntrance = spring({
    frame,
    fps,
    config: SPRINGS.snappy,
  });
  const titleY = interpolate(titleEntrance, [0, 1], [-50, 0]);
  const titleOpacity = interpolate(titleEntrance, [0, 1], [0, 1]);

  // Highlight phase (subtle red emphasis)
  const highlightStart = 90;
  const isHighlighting = frame >= highlightStart && frame < highlightStart + 60;

  // Fade out
  const fadeOutStart = durationInFrames - 30;
  const fadeOut = interpolate(frame, [fadeOutStart, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
        opacity: fadeOut,
      }}
    >
      {/* Title */}
      <div
        style={{
          transform: `translateY(${titleY}px)`,
          opacity: titleOpacity,
          marginBottom: 60,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <Warning size={48} weight="fill" color={COLORS.accent.sell.solid} />
        <span
          style={{
            fontSize: TYPOGRAPHY.h1.size,
            fontWeight: TYPOGRAPHY.h1.weight,
            color: COLORS.text.primary,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          The Problem
        </span>
      </div>

      {/* Problem cards */}
      <div
        style={{
          display: "flex",
          gap: 40,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {PROBLEMS.map((problem, index) => (
          <ProblemCard
            key={problem.title}
            problem={problem}
            index={index}
            frame={frame}
            fps={fps}
            isHighlighting={isHighlighting}
          />
        ))}
      </div>

      {/* Bottom text */}
      <div
        style={{
          marginTop: 60,
          opacity:
            frame > 90
              ? interpolate(frame, [90, 120], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                })
              : 0,
        }}
      >
        <span
          style={{
            fontSize: TYPOGRAPHY.body.size,
            fontWeight: TYPOGRAPHY.body.weight,
            color: COLORS.text.secondary,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          Your strategy is exposed to everyone.
        </span>
      </div>
    </AbsoluteFill>
  );
};

interface ProblemCardProps {
  problem: (typeof PROBLEMS)[number];
  index: number;
  frame: number;
  fps: number;
  isHighlighting: boolean;
}

const ProblemCard: React.FC<ProblemCardProps> = ({
  problem,
  index,
  frame,
  fps,
  isHighlighting,
}) => {
  // Staggered entrance
  const entranceDelay = 30 + index * 15;
  const entrance = spring({
    frame: frame - entranceDelay,
    fps,
    config: SPRINGS.snappy,
  });

  const scale = interpolate(entrance, [0, 1], [0.8, 1]);
  const opacity = interpolate(entrance, [0, 1], [0, 1]);
  const y = interpolate(entrance, [0, 1], [30, 0]);

  const Icon = ICONS[problem.icon as keyof typeof ICONS] || Warning;

  return (
    <div
      style={{
        width: 300,
        padding: 32,
        borderRadius: 16,
        backgroundColor: COLORS.surface[5],
        border: `1px solid ${isHighlighting ? COLORS.accent.sell.border : COLORS.border.subtle}`,
        opacity,
        transform: `scale(${scale}) translateY(${y}px)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 16,
          backgroundColor: COLORS.accent.sell.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={40} weight="duotone" color={COLORS.accent.sell.text} />
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: TYPOGRAPHY.h3.size,
          fontWeight: TYPOGRAPHY.h3.weight,
          color: COLORS.text.primary,
          fontFamily: "'Inter', system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        {problem.title}
      </div>

      {/* Description */}
      <div
        style={{
          fontSize: TYPOGRAPHY.small.size,
          fontWeight: TYPOGRAPHY.small.weight,
          color: COLORS.text.secondary,
          fontFamily: "'Inter', system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        {problem.description}
      </div>
    </div>
  );
};

export default ProblemScene;
