/**
 * Layer1Scene
 * ZK Proofs - "Prove Eligibility, Reveal Nothing"
 *
 * Timeline (210 frames / 7 seconds @ 30fps):
 * - 0-30: Title entrance with glow
 * - 30-90: Merkle tree building animation with particle effects
 * - 90-150: Proof generation progress with pulsing glow
 * - 150-180: Shield + checkmark with celebration particles
 * - 180-210: Final text
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  AbsoluteFill,
} from "remotion";
import { Shield, CheckCircle, TreeStructure, Fingerprint } from "@phosphor-icons/react";
import { COLORS, SPRINGS, TYPOGRAPHY } from "../lib/constants";
import {
  progressBar,
  pulse,
  generateParticles,
  scalePop,
} from "../lib/animations";
import { TextReveal } from "../components/video/TextReveal";

export const Layer1Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Title animation
  const titleEntrance = spring({
    frame,
    fps,
    config: SPRINGS.snappy,
  });
  const titleOpacity = interpolate(titleEntrance, [0, 1], [0, 1]);
  const titleY = interpolate(titleEntrance, [0, 1], [30, 0]);

  // Merkle tree animation timing
  const treeStart = 30;
  const treeProgress = progressBar(frame, treeStart, treeStart + 60);

  // Proof generation progress
  const proofStart = 90;
  const proofProgress = progressBar(frame, proofStart, proofStart + 60);

  // Shield checkmark animation with scale pop
  const checkStart = 150;
  const checkEntrance = spring({
    frame: frame - checkStart,
    fps,
    config: SPRINGS.bouncy,
  });
  const checkScale = scalePop(frame, fps, checkStart, 1.2);
  const isComplete = frame >= checkStart;

  // Final text - start earlier so it's fully visible before scene ends
  const textStart = 140;

  // Background particles (reduced count for performance)
  const particles = generateParticles(frame, fps, 6, { width: 1920, height: 1080 }, 456);

  // Fade out at end
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
        overflow: "hidden",
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 40%, ${COLORS.accent.privacy.full}${isComplete ? "15" : "08"} 0%, transparent 60%)`,
        }}
      />

      {/* Floating particles (optimized - no boxShadow) */}
      {particles.map((particle, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: particle.x,
            top: particle.y,
            width: 3 * particle.scale,
            height: 3 * particle.scale,
            borderRadius: "50%",
            backgroundColor: COLORS.accent.privacy.full,
            opacity: particle.opacity * 0.35,
          }}
        />
      ))}
      {/* Layer badge */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            padding: "6px 16px",
            borderRadius: 999,
            backgroundColor: `${COLORS.accent.privacy.full}15`,
            border: `1px solid ${COLORS.accent.privacy.full}30`,
            fontSize: 14,
            fontWeight: 600,
            color: COLORS.accent.privacy.full,
            letterSpacing: 1,
            textTransform: "uppercase",
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          Layer 1
        </div>
      </div>

      {/* Title */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 48,
        }}
      >
        <Shield size={56} weight="duotone" color={COLORS.accent.privacy.full} />
        <span
          style={{
            fontSize: TYPOGRAPHY.h1.size,
            fontWeight: TYPOGRAPHY.h1.weight,
            color: COLORS.text.primary,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          ZK Compliance
        </span>
      </div>

      {/* Main visualization area */}
      <div
        style={{
          display: "flex",
          gap: 80,
          alignItems: "center",
          marginBottom: 48,
        }}
      >
        {/* Merkle tree visualization */}
        <MerkleTreeViz progress={treeProgress} frame={frame} fps={fps} />

        {/* Proof generation */}
        <ProofGenerationViz
          progress={proofProgress}
          isComplete={frame >= checkStart}
          checkEntrance={checkEntrance}
          frame={frame}
          fps={fps}
        />
      </div>

      {/* Bottom text */}
      <div style={{ height: 40 }}>
        {frame >= textStart && (
          <TextReveal
            text="Prove eligibility without revealing identity"
            startFrame={textStart}
            charsPerFrame={1.5}
            fontSize={TYPOGRAPHY.bodyLarge.size}
            fontWeight={TYPOGRAPHY.bodyLarge.weight}
            color={COLORS.text.secondary}
          />
        )}
      </div>

      {/* Tech badge */}
      <div
        style={{
          marginTop: 24,
          padding: "8px 16px",
          borderRadius: 999,
          backgroundColor: COLORS.surface[5],
          fontSize: 14,
          color: COLORS.text.muted,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        Noir + Sunspot Groth16
      </div>
    </AbsoluteFill>
  );
};

/**
 * Simplified Merkle tree visualization
 */
const MerkleTreeViz: React.FC<{
  progress: number;
  frame: number;
  fps: number;
}> = ({ progress, frame, fps }) => {
  const levels = 4;
  const nodeSize = 32;
  const gapX = 16;
  const gapY = 48;

  // Build nodes for each level
  const nodes: { level: number; index: number; x: number; y: number }[] = [];

  for (let level = 0; level < levels; level++) {
    const nodesInLevel = Math.pow(2, level);
    const levelWidth = nodesInLevel * nodeSize + (nodesInLevel - 1) * gapX;
    const startX = (300 - levelWidth) / 2;

    for (let i = 0; i < nodesInLevel; i++) {
      nodes.push({
        level,
        index: i,
        x: startX + i * (nodeSize + gapX),
        y: level * gapY,
      });
    }
  }

  const totalNodes = nodes.length;
  const visibleNodes = Math.floor(progress * totalNodes);

  return (
    <div
      style={{
        position: "relative",
        width: 300,
        height: levels * gapY,
      }}
    >
      {/* Draw connections first */}
      {nodes.slice(0, visibleNodes).map((node, idx) => {
        if (node.level === 0) return null;

        const parentIndex = Math.floor(node.index / 2);
        const parentLevel = node.level - 1;
        const parent = nodes.find(
          (n) => n.level === parentLevel && n.index === parentIndex
        );

        if (!parent) return null;

        const opacity = interpolate(
          idx / totalNodes,
          [0, progress],
          [0, 1],
          { extrapolateRight: "clamp" }
        );

        return (
          <svg
            key={`line-${idx}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          >
            <line
              x1={parent.x + nodeSize / 2}
              y1={parent.y + nodeSize}
              x2={node.x + nodeSize / 2}
              y2={node.y}
              stroke={COLORS.accent.privacy.full}
              strokeWidth={2}
              opacity={opacity * 0.5}
            />
          </svg>
        );
      })}

      {/* Draw nodes */}
      {nodes.slice(0, visibleNodes).map((node, idx) => {
        const nodeProgress = interpolate(
          progress,
          [idx / totalNodes, (idx + 1) / totalNodes],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        const scale = interpolate(nodeProgress, [0, 1], [0, 1]);
        const opacity = interpolate(nodeProgress, [0, 0.5, 1], [0, 1, 1]);

        const isRoot = node.level === 0;

        return (
          <div
            key={idx}
            style={{
              position: "absolute",
              left: node.x,
              top: node.y,
              width: nodeSize,
              height: nodeSize,
              borderRadius: isRoot ? 8 : 4,
              backgroundColor: isRoot
                ? COLORS.accent.privacy.full
                : COLORS.surface[20],
              border: `2px solid ${
                isRoot ? COLORS.accent.privacy.full : COLORS.border.emphasis
              }`,
              transform: `scale(${scale})`,
              opacity,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isRoot && (
              <TreeStructure
                size={16}
                weight="bold"
                color={COLORS.background}
              />
            )}
          </div>
        );
      })}

      {/* Label */}
      <div
        style={{
          position: "absolute",
          bottom: -40,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 14,
          color: COLORS.text.muted,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        Merkle Tree (20 levels)
      </div>
    </div>
  );
};

/**
 * Proof generation visualization
 */
const ProofGenerationViz: React.FC<{
  progress: number;
  isComplete: boolean;
  checkEntrance: number;
  frame: number;
  fps: number;
}> = ({ progress, isComplete, checkEntrance, frame, fps }) => {
  const pulseValue = pulse(frame, fps, 1);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
        width: 300,
      }}
    >
      {/* Proof icon */}
      <div
        style={{
          width: 100,
          height: 100,
          borderRadius: 20,
          backgroundColor: isComplete
            ? `${COLORS.accent.privacy.full}20`
            : COLORS.surface[10],
          border: `2px solid ${
            isComplete ? COLORS.accent.privacy.full : COLORS.border.emphasis
          }`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          boxShadow: isComplete
            ? `0 0 30px ${COLORS.accent.privacy.full}40`
            : "none",
        }}
      >
        {isComplete ? (
          <CheckCircle
            size={56}
            weight="fill"
            color={COLORS.accent.privacy.full}
            style={{
              transform: `scale(${checkEntrance})`,
            }}
          />
        ) : (
          <Fingerprint
            size={48}
            weight="duotone"
            color={COLORS.text.secondary}
            style={{
              opacity: 0.5 + pulseValue * 0.5,
            }}
          />
        )}
      </div>

      {/* Progress bar */}
      <div
        style={{
          width: "100%",
          height: 8,
          backgroundColor: COLORS.surface[10],
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            backgroundColor: isComplete
              ? COLORS.accent.privacy.full
              : COLORS.text.secondary,
            borderRadius: 4,
            transition: "background-color 0.3s",
          }}
        />
      </div>

      {/* Status text */}
      <div
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: isComplete ? COLORS.accent.privacy.full : COLORS.text.secondary,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {isComplete
          ? "Proof Verified ✓"
          : `Generating... ${Math.round(progress * 100)}%`}
      </div>

      {/* Proof size badge */}
      <div
        style={{
          padding: "4px 12px",
          borderRadius: 999,
          backgroundColor: COLORS.surface[5],
          fontSize: 12,
          color: COLORS.text.muted,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        324 bytes • ~200K CU
      </div>
    </div>
  );
};

export default Layer1Scene;
