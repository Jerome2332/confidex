/**
 * CTAScene
 * Call to action - "Trade Privately Today"
 *
 * Timeline (150 frames / 5 seconds @ 30fps):
 * - 0-30: Title entrance
 * - 30-60: CTA button entrance
 * - 60-90: Social links / badges
 * - 90-150: Hold with pulse animation
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
import {
  Shield,
  ArrowRight,
  GithubLogo,
  TwitterLogo,
  Globe,
} from "@phosphor-icons/react";
import { COLORS, SPRINGS, TYPOGRAPHY } from "../lib/constants";
import { pulse } from "../lib/animations";

export const CTAScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Title entrance
  const titleEntrance = spring({
    frame,
    fps,
    config: SPRINGS.snappy,
  });
  const titleY = interpolate(titleEntrance, [0, 1], [40, 0]);
  const titleOpacity = interpolate(titleEntrance, [0, 1], [0, 1]);

  // CTA button entrance
  const ctaEntrance = spring({
    frame: frame - 30,
    fps,
    config: SPRINGS.snappy,
  });

  // Social links entrance
  const socialsEntrance = spring({
    frame: frame - 60,
    fps,
    config: SPRINGS.snappy,
  });

  // Pulse for CTA button
  const pulseValue = pulse(frame, fps, 0.5);
  const ctaGlow = interpolate(pulseValue, [0, 1], [20, 40]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
      }}
    >
      {/* Logo Icon */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          marginBottom: 24,
        }}
      >
        <Img
          src={staticFile("images/logo-icon.svg")}
          style={{
            width: 100,
            height: 100,
          }}
        />
      </div>

      {/* Logo Wordmark */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          marginBottom: 16,
        }}
      >
        <Img
          src={staticFile("images/logo-wordmark.svg")}
          style={{
            width: 400,
            height: "auto",
          }}
        />
      </div>

      {/* Tagline */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          textAlign: "center",
          marginBottom: 48,
        }}
      >
        <span
          style={{
            fontSize: TYPOGRAPHY.h2.size,
            fontWeight: TYPOGRAPHY.h2.weight,
            color: COLORS.text.secondary,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          Trade Privately on Solana
        </span>
      </div>

      {/* CTA Button */}
      <div
        style={{
          transform: `scale(${ctaEntrance})`,
          marginBottom: 48,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "20px 40px",
            borderRadius: 16,
            backgroundColor: COLORS.accent.privacy.full,
            boxShadow: `0 0 ${ctaGlow}px ${COLORS.accent.privacy.full}60`,
            cursor: "pointer",
          }}
        >
          <span
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: COLORS.background,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            Start Trading
          </span>
          <ArrowRight size={28} weight="bold" color={COLORS.background} />
        </div>
      </div>

      {/* Privacy features badges */}
      <div
        style={{
          opacity: interpolate(socialsEntrance, [0, 1], [0, 1]),
          transform: `translateY(${interpolate(
            socialsEntrance,
            [0, 1],
            [20, 0]
          )}px)`,
          display: "flex",
          gap: 16,
          marginBottom: 48,
        }}
      >
        <FeatureBadge icon={Shield} label="ZK Proofs" />
        <FeatureBadge icon={Shield} label="MPC Matching" />
        <FeatureBadge icon={Shield} label="Private Settlement" />
      </div>

      {/* Social links */}
      <div
        style={{
          opacity: interpolate(socialsEntrance, [0, 1], [0, 1]),
          transform: `translateY(${interpolate(
            socialsEntrance,
            [0, 1],
            [20, 0]
          )}px)`,
          display: "flex",
          gap: 24,
        }}
      >
        <SocialLink icon={Globe} label="confidex.xyz" />
        <SocialLink icon={TwitterLogo} label="@Confidex_Trade" />
        <SocialLink icon={GithubLogo} label="GitHub" />
      </div>

      {/* Footer text */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          opacity: interpolate(socialsEntrance, [0, 1], [0, 0.5]),
        }}
      >
        <span
          style={{
            fontSize: 14,
            color: COLORS.text.muted,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Powered by Arcium MPC • Noir ZK • ShadowWire
        </span>
      </div>
    </AbsoluteFill>
  );
};

/**
 * Feature badge component
 */
const FeatureBadge: React.FC<{
  icon: React.ElementType;
  label: string;
}> = ({ icon: Icon, label }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        borderRadius: 999,
        backgroundColor: COLORS.surface[5],
        border: `1px solid ${COLORS.border.subtle}`,
      }}
    >
      <Icon size={16} weight="fill" color={COLORS.accent.privacy.full} />
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: COLORS.text.secondary,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {label}
      </span>
    </div>
  );
};

/**
 * Social link component
 */
const SocialLink: React.FC<{
  icon: React.ElementType;
  label: string;
}> = ({ icon: Icon, label }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 20px",
        borderRadius: 12,
        backgroundColor: COLORS.surface[10],
        border: `1px solid ${COLORS.border.subtle}`,
      }}
    >
      <Icon size={20} weight="fill" color={COLORS.text.secondary} />
      <span
        style={{
          fontSize: 16,
          fontWeight: 400,
          color: COLORS.text.secondary,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {label}
      </span>
    </div>
  );
};

export default CTAScene;
