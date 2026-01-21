/**
 * SolutionScene
 * Introduces Confidex and the 3-layer architecture overview
 *
 * Timeline (300 frames / 10 seconds @ 30fps):
 * - 0-30: Title fade in with glow
 * - 30-90: Solution text reveal
 * - 90-150: Privacy layers animation with 3D effect
 * - 150-300: Hold with animated particles and data flow
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  AbsoluteFill,
} from "remotion";
import { ShieldCheck, Sparkle } from "@phosphor-icons/react";
import { COLORS, SPRINGS, TYPOGRAPHY } from "../lib/constants";
import { TextReveal, WordReveal } from "../components/video/TextReveal";
import { PrivacyLayerAnimation } from "../components/video/PrivacyLayerAnimation";
import {
  pulse,
  animatedGlow,
  generateParticles,
  tilt3D,
  animatedGradientPosition,
} from "../lib/animations";

export const SolutionScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Title animation
  const titleEntrance = spring({
    frame,
    fps,
    config: SPRINGS.smooth,
  });
  const titleOpacity = interpolate(titleEntrance, [0, 1], [0, 1]);
  const titleY = interpolate(titleEntrance, [0, 1], [30, 0]);

  // Solution text
  const textStart = 30;

  // Layers animation with 3D tilt
  const layersStart = 120;
  const layersEntrance = spring({
    frame: frame - layersStart,
    fps,
    config: SPRINGS.snappy,
  });
  const layersOpacity = interpolate(layersEntrance, [0, 1], [0, 1]);
  const layersScale = interpolate(layersEntrance, [0, 1], [0.9, 1]);
  const tilt = tilt3D(frame, fps, layersStart, 8, 12);

  // Sparkle icon animation
  const sparkleRotation = interpolate(pulse(frame, fps, 0.3), [0, 1], [-5, 5]);
  const sparkleScale = interpolate(pulse(frame, fps, 0.5), [0, 1], [0.95, 1.05]);
  const sparkleGlow = animatedGlow(frame, fps, COLORS.accent.privacy.full, 0.4, 0.8, 0.6);

  // Background gradient animation
  const gradientPos = animatedGradientPosition(frame, fps, 0.3);

  // Generate floating particles (reduced count for performance)
  const particles = generateParticles(frame, fps, 8, { width: 1920, height: 1080 }, 123);

  // Badge glow
  const badgeGlow = animatedGlow(frame, fps, COLORS.accent.privacy.full, 0.2, 0.5, 0.4);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        overflow: "hidden",
      }}
    >
      {/* Animated radial gradient background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at ${gradientPos.x}% ${gradientPos.y}%, ${COLORS.accent.privacy.full}08 0%, transparent 50%)`,
          opacity: interpolate(frame, [0, 60], [0, 1], { extrapolateRight: "clamp" }),
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
            width: 4 * particle.scale,
            height: 4 * particle.scale,
            borderRadius: "50%",
            backgroundColor: COLORS.accent.privacy.full,
            opacity: particle.opacity * 0.4 * interpolate(frame, [0, 60], [0, 1], { extrapolateRight: "clamp" }),
          }}
        />
      ))}
      {/* Title - fixed position at top */}
      <div
        style={{
          position: "absolute",
          top: 260,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              transform: `rotate(${sparkleRotation}deg) scale(${sparkleScale})`,
              filter: `drop-shadow(${sparkleGlow.split(",")[0]})`,
            }}
          >
            <Sparkle size={48} weight="fill" color={COLORS.accent.privacy.full} />
          </div>
          <span
            style={{
              fontSize: TYPOGRAPHY.h1.size,
              fontWeight: TYPOGRAPHY.h1.weight,
              color: COLORS.text.primary,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            The Solution
          </span>
        </div>
      </div>

      {/* Solution text - fixed position below title */}
      <div
        style={{
          position: "absolute",
          top: 350,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            maxWidth: 800,
            textAlign: "center",
            minHeight: 80, // Reserve space to prevent layout shift
          }}
        >
          {frame >= textStart && (
            <WordReveal
              text="Confidex changes everything. Three layers of cryptographic protection for complete privacy."
              startFrame={textStart}
              framesPerWord={4}
              fontSize={TYPOGRAPHY.bodyLarge.size}
              fontWeight={TYPOGRAPHY.bodyLarge.weight}
              color={COLORS.text.secondary}
              highlightColor={COLORS.text.primary}
            />
          )}
        </div>
      </div>

      {/* Privacy layers - fixed position in center with 3D tilt */}
      <div
        style={{
          position: "absolute",
          top: 480,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: layersOpacity,
          transform: `scale(${layersScale}) perspective(${tilt.perspective}px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg)`,
          transformStyle: "preserve-3d",
        }}
      >
        <PrivacyLayerAnimation
          activeLayer={0}
          showConnections={true}
          variant="horizontal"
          size="medium"
        />
      </div>

      {/* Bottom badge - fixed position at bottom with glow */}
      <div
        style={{
          position: "absolute",
          bottom: 100,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: frame > 200 ? interpolate(frame, [200, 230], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }) : 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 24px",
            borderRadius: 12,
            backgroundColor: COLORS.surface[5],
            border: `1px solid ${COLORS.accent.privacy.full}30`,
            boxShadow: badgeGlow,
          }}
        >
          <ShieldCheck
            size={24}
            weight="fill"
            color={COLORS.accent.privacy.full}
          />
          <span
            style={{
              fontSize: 18,
              fontWeight: 400,
              color: COLORS.text.secondary,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            Zero-Knowledge • Multi-Party Computation • Confidential Transfers
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export default SolutionScene;
