/**
 * IntroScene
 * Logo reveal + tagline animation with enhanced effects
 *
 * Timeline (210 frames / 7 seconds @ 30fps):
 * - 0-30: Black screen with subtle particles
 * - 30-60: Logo icon fade in with glow
 * - 60-90: Logo wordmark fade in
 * - 90-140: Tagline typewriter with blur reveal
 * - 140-180: Privacy badge fade in
 * - 180-210: Fade out
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  AbsoluteFill,
  Img,
  staticFile,
} from "remotion";
import { Shield } from "@phosphor-icons/react";
import { COLORS, SPRINGS, TYPOGRAPHY } from "../lib/constants";
import { TextReveal } from "../components/video/TextReveal";
import {
  generateParticles,
  animatedGlow,
  scalePop,
  blurReveal,
} from "../lib/animations";

interface IntroSceneProps {
  tagline?: string;
}

export const IntroScene: React.FC<IntroSceneProps> = ({
  tagline = "The First Private DEX on Solana",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  // Fade out at end of scene (last 30 frames = 1 second)
  const fadeOutStart = durationInFrames - 30;
  const fadeOut = interpolate(
    frame,
    [fadeOutStart, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  // Generate floating particles
  const particles = generateParticles(frame, fps, 25, { width, height }, 42);

  // Logo icon animations with enhanced glow
  const logoIconFadeStart = 30;
  const logoIconFade = interpolate(
    frame,
    [logoIconFadeStart, logoIconFadeStart + 20],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  // Use scalePop for bouncy entrance
  const logoIconScaleValue = scalePop(frame, fps, logoIconFadeStart, 1.1);

  // Animated glow for logo
  const logoGlow = animatedGlow(
    frame,
    fps,
    COLORS.accent.privacy.full,
    0.4,
    0.8,
    0.6
  );

  // Logo wordmark animations
  const wordmarkFadeStart = 50;
  const wordmarkFade = interpolate(
    frame,
    [wordmarkFadeStart, wordmarkFadeStart + 25],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const wordmarkY = interpolate(
    frame,
    [wordmarkFadeStart, wordmarkFadeStart + 25],
    [20, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  // Blur reveal for wordmark
  const wordmarkBlur = blurReveal(frame, wordmarkFadeStart, 25);

  // Tagline animation
  const taglineStart = 90;
  const taglineBlur = blurReveal(frame, taglineStart, 30);

  // Privacy badge animation with pop
  const badgeStart = 130;
  const badgeScale = scalePop(frame, fps, badgeStart, 1.15);
  const badgeFade = interpolate(frame, [badgeStart, badgeStart + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Badge glow (subtle)
  const badgeGlow = `0 0 8px ${COLORS.accent.privacy.full}20`;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut,
        overflow: "hidden",
      }}
    >
      {/* Floating particles */}
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
            opacity: particle.opacity * 0.4 * logoIconFade,
            boxShadow: `0 0 ${6 * particle.scale}px ${COLORS.accent.privacy.full}`,
            pointerEvents: "none",
          }}
        />
      ))}

      {/* Logo Icon with glow */}
      <div
        style={{
          opacity: logoIconFade,
          transform: `scale(${logoIconScaleValue})`,
          filter: `drop-shadow(${logoGlow.split(",")[0]})`,
        }}
      >
        <Img
          src={staticFile("images/logo-icon.svg")}
          style={{
            width: 140,
            height: 140,
          }}
        />
      </div>

      {/* Logo Wordmark with blur reveal */}
      <div
        style={{
          marginTop: 32,
          opacity: wordmarkFade,
          transform: `translateY(${wordmarkY}px)`,
          filter: `blur(${wordmarkBlur}px)`,
        }}
      >
        <Img
          src={staticFile("images/logo-wordmark.svg")}
          style={{
            width: 500,
            height: "auto",
          }}
        />
      </div>

      {/* Tagline with blur reveal */}
      <div
        style={{
          marginTop: 40,
          height: 50,
          filter: `blur(${taglineBlur}px)`,
        }}
      >
        {frame >= taglineStart && (
          <TextReveal
            text={tagline}
            startFrame={taglineStart}
            charsPerFrame={0.8}
            fontSize={TYPOGRAPHY.h2.size}
            fontWeight={TYPOGRAPHY.h2.weight}
            color={COLORS.text.secondary}
            showCursor={false}
          />
        )}
      </div>

      {/* Privacy badge with pop and glow */}
      <div
        style={{
          marginTop: 28,
          opacity: badgeFade,
          transform: `scale(${badgeScale})`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 20px",
            borderRadius: 999,
            backgroundColor: `${COLORS.accent.privacy.full}15`,
            border: `1px solid ${COLORS.accent.privacy.full}30`,
            boxShadow: badgeGlow,
          }}
        >
          <Shield
            size={22}
            weight="fill"
            color={COLORS.accent.privacy.full}
          />
          <span
            style={{
              fontSize: 18,
              fontWeight: 500,
              color: COLORS.accent.privacy.full,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            Full Privacy
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export default IntroScene;
