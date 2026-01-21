/**
 * Layer2Scene
 * MPC Matching - "Encrypted Price Comparison"
 *
 * Timeline (240 frames / 8 seconds @ 30fps):
 * - 0-30: Title entrance
 * - 30-60: Four Arx nodes appear
 * - 60-150: Encrypted packets flow between nodes
 * - 150-180: Center "Match Found" indicator
 * - 180-240: Lock icons pulse green
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  AbsoluteFill,
} from "remotion";
import { Lock, CheckCircle, CircleNotch, Cpu } from "@phosphor-icons/react";
import { COLORS, SPRINGS, TYPOGRAPHY } from "../lib/constants";
import { pulse } from "../lib/animations";
import { TextReveal } from "../components/video/TextReveal";

export const Layer2Scene: React.FC = () => {
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

  // Match found timing
  const matchFoundStart = 150;
  const isMatchFound = frame >= matchFoundStart;

  // Final text
  const textStart = 180;

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
      }}
    >
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
          Layer 2
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
        <Lock size={56} weight="duotone" color={COLORS.accent.privacy.full} />
        <span
          style={{
            fontSize: TYPOGRAPHY.h1.size,
            fontWeight: TYPOGRAPHY.h1.weight,
            color: COLORS.text.primary,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          MPC Matching
        </span>
      </div>

      {/* MPC Network visualization */}
      <MPCNetworkViz
        frame={frame}
        fps={fps}
        isMatchFound={isMatchFound}
      />

      {/* Bottom text */}
      <div style={{ height: 40, marginTop: 48 }}>
        {frame >= textStart && (
          <TextReveal
            text="Prices compared without ever being decrypted"
            startFrame={textStart}
            charsPerFrame={1}
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
        Arcium Cerberus Protocol
      </div>
    </AbsoluteFill>
  );
};

/**
 * MPC Network with 4 nodes in diamond formation
 */
const MPCNetworkViz: React.FC<{
  frame: number;
  fps: number;
  isMatchFound: boolean;
}> = ({ frame, fps, isMatchFound }) => {
  const size = 400;
  const nodeSize = 70;
  const centerSize = 90;

  // Node positions (diamond formation)
  const nodes = [
    { x: size / 2, y: 40, label: "Node 1" }, // Top
    { x: size - 40, y: size / 2, label: "Node 2" }, // Right
    { x: size / 2, y: size - 40, label: "Node 3" }, // Bottom
    { x: 40, y: size / 2, label: "Node 4" }, // Left
  ];

  // Node entrance staggered
  const nodesEntrance = nodes.map((_, i) => {
    const delay = 30 + i * 8;
    return spring({
      frame: frame - delay,
      fps,
      config: SPRINGS.snappy,
    });
  });

  // Data packets
  const packetStart = 60;
  const numPackets = 8;
  const loopDuration = 90;

  const pulseValue = pulse(frame, fps, 0.5);

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        isolation: "isolate",
      }}
    >
      {/* Connection lines - rendered as background layer */}
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        {nodes.map((node, i) => {
          const nextNode = nodes[(i + 1) % nodes.length];
          const opacity = Math.min(nodesEntrance[i], nodesEntrance[(i + 1) % nodes.length]);

          return (
            <line
              key={`line-${i}`}
              x1={node.x}
              y1={node.y}
              x2={nextNode.x}
              y2={nextNode.y}
              stroke={isMatchFound ? COLORS.accent.privacy.full : COLORS.border.emphasis}
              strokeWidth={2}
              opacity={opacity * 0.5}
              strokeDasharray={isMatchFound ? "none" : "8 4"}
            />
          );
        })}

        {/* Lines to center */}
        {nodes.map((node, i) => {
          const opacity = nodesEntrance[i];
          return (
            <line
              key={`center-line-${i}`}
              x1={node.x}
              y1={node.y}
              x2={size / 2}
              y2={size / 2}
              stroke={isMatchFound ? COLORS.accent.privacy.full : COLORS.border.subtle}
              strokeWidth={1}
              opacity={opacity * 0.3}
            />
          );
        })}
      </svg>

      {/* Data packets - smooth continuous movement around the diamond */}
      {!isMatchFound &&
        Array.from({ length: numPackets }).map((_, i) => {
          // Each packet has a phase offset so they're evenly distributed
          const phaseOffset = i / numPackets;

          // Calculate continuous progress around the perimeter (0 to 1 = full loop)
          // Speed: complete one loop every 90 frames (3 seconds)
          const rawProgress = ((frame - packetStart) / loopDuration + phaseOffset) % 1;

          // Only show packets after packetStart
          if (frame < packetStart) return null;

          // Map progress (0-1) to position around 4 edges
          // 0-0.25 = edge 0 (node 0 to node 1)
          // 0.25-0.5 = edge 1 (node 1 to node 2)
          // 0.5-0.75 = edge 2 (node 2 to node 3)
          // 0.75-1 = edge 3 (node 3 to node 0)
          const edgeProgress = rawProgress * 4;
          const edgeIndex = Math.floor(edgeProgress) % 4;
          const progressOnEdge = edgeProgress - edgeIndex;

          const startNode = nodes[edgeIndex];
          const endNode = nodes[(edgeIndex + 1) % nodes.length];

          // Linear interpolation for smooth constant-speed movement
          const x = interpolate(progressOnEdge, [0, 1], [startNode.x, endNode.x]);
          const y = interpolate(progressOnEdge, [0, 1], [startNode.y, endNode.y]);

          return (
            <div
              key={`packet-${i}`}
              style={{
                position: "absolute",
                left: x - 6,
                top: y - 6,
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: COLORS.accent.privacy.full,
                opacity: 0.9,
                boxShadow: `0 0 10px ${COLORS.accent.privacy.full}`,
              }}
            />
          );
        })}

      {/* Arx Nodes */}
      {nodes.map((node, i) => {
        const entrance = nodesEntrance[i];
        const scale = interpolate(entrance, [0, 1], [0.5, 1]);
        const opacity = interpolate(entrance, [0, 1], [0, 1]);

        const isActive = isMatchFound;
        const glowIntensity = isActive ? 0.3 + pulseValue * 0.4 : 0;

        return (
          <div
            key={`node-${i}`}
            style={{
              position: "absolute",
              left: node.x - nodeSize / 2,
              top: node.y - nodeSize / 2,
              width: nodeSize,
              height: nodeSize,
              borderRadius: 16,
              backgroundColor: "#1a1a1a",
              border: `2px solid ${
                isActive ? COLORS.accent.privacy.full : COLORS.border.emphasis
              }`,
              transform: `scale(${scale})`,
              opacity,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              boxShadow: isActive
                ? `0 0 ${20 * glowIntensity}px ${COLORS.accent.privacy.full}60`
                : "none",
              zIndex: 1,
            }}
          >
            <Cpu
              size={24}
              weight={isActive ? "fill" : "regular"}
              color={isActive ? COLORS.accent.privacy.full : COLORS.text.secondary}
            />
            <span
              style={{
                fontSize: 10,
                color: COLORS.text.muted,
                fontWeight: 500,
                fontFamily: "'Inter', system-ui, sans-serif",
              }}
            >
              Arx {i + 1}
            </span>
          </div>
        );
      })}

      {/* Center indicator */}
      <div
        style={{
          position: "absolute",
          left: size / 2 - centerSize / 2,
          top: size / 2 - centerSize / 2,
          width: centerSize,
          height: centerSize,
          borderRadius: 20,
          backgroundColor: isMatchFound ? "#0a2a1a" : "#1a1a1a",
          border: `2px solid ${
            isMatchFound ? COLORS.accent.privacy.full : COLORS.border.subtle
          }`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          boxShadow: isMatchFound
            ? `0 0 30px ${COLORS.accent.privacy.full}40`
            : "none",
          zIndex: 2,
        }}
      >
        {isMatchFound ? (
          <>
            <CheckCircle
              size={36}
              weight="fill"
              color={COLORS.accent.privacy.full}
            />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.accent.privacy.full,
                fontFamily: "'Inter', system-ui, sans-serif",
              }}
            >
              MATCH
            </span>
          </>
        ) : (
          <>
            <CircleNotch
              size={32}
              weight="bold"
              color={COLORS.text.muted}
              style={{
                animation: "none",
                transform: `rotate(${frame * 3}deg)`,
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: COLORS.text.muted,
                fontFamily: "'Inter', system-ui, sans-serif",
              }}
            >
              Comparing
            </span>
          </>
        )}
      </div>

      {/* Lock badges on each node */}
      {nodes.map((node, i) => {
        if (!isMatchFound) return null;

        const lockDelay = 150 + i * 5;
        const lockEntrance = spring({
          frame: frame - lockDelay,
          fps,
          config: SPRINGS.bouncy,
        });

        return (
          <div
            key={`lock-${i}`}
            style={{
              position: "absolute",
              left: node.x + nodeSize / 2 - 12,
              top: node.y - nodeSize / 2 - 8,
              transform: `scale(${lockEntrance})`,
              zIndex: 3,
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: COLORS.accent.privacy.full,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Lock size={14} weight="fill" color={COLORS.background} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default Layer2Scene;
