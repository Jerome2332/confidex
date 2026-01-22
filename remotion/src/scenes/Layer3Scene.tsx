/**
 * Layer3Scene
 * Private Settlement - "Confidential Token Transfers"
 *
 * Timeline (210 frames / 7 seconds @ 30fps):
 * - 0-30: Title entrance
 * - 30-90: Token transfer animation
 * - 90-120: Amount hidden with lock icon
 * - 120-150: "Transfer Complete" checkmark
 * - 150-210: Final text and badges
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  AbsoluteFill,
} from "remotion";
import {
  Lightning,
  CheckCircle,
  Lock,
  Wallet,
  ArrowRight,
  CurrencyDollar,
  Eye,
  EyeSlash,
} from "@phosphor-icons/react";
import { COLORS, SPRINGS, TYPOGRAPHY } from "../lib/constants";
import { pulse } from "../lib/animations";
import { TextReveal } from "../components/video/TextReveal";

export const Layer3Scene: React.FC = () => {
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

  // Transfer complete timing
  const transferCompleteStart = 120;
  const isComplete = frame >= transferCompleteStart;

  // Final text
  const textStart = 150;

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
          Layer 3
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
          marginBottom: 24,
        }}
      >
        <Lightning
          size={56}
          weight="duotone"
          color={COLORS.accent.privacy.full}
        />
        <span
          style={{
            fontSize: TYPOGRAPHY.h1.size,
            fontWeight: TYPOGRAPHY.h1.weight,
            color: COLORS.text.primary,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          Private Settlement
        </span>
      </div>

      {/* Transfer Complete badge - appears below title */}
      <div
        style={{
          marginBottom: 40,
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isComplete && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              borderRadius: 999,
              backgroundColor: `${COLORS.accent.privacy.full}15`,
              border: `1px solid ${COLORS.accent.privacy.full}40`,
              opacity: spring({
                frame: frame - transferCompleteStart,
                fps,
                config: SPRINGS.snappy,
              }),
              transform: `scale(${spring({
                frame: frame - transferCompleteStart,
                fps,
                config: SPRINGS.bouncy,
              })})`,
            }}
          >
            <CheckCircle
              size={22}
              weight="fill"
              color={COLORS.accent.privacy.full}
            />
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: COLORS.accent.privacy.full,
                fontFamily: "'Inter', system-ui, sans-serif",
              }}
            >
              Transfer Complete
            </span>
          </div>
        )}
      </div>

      {/* Transfer visualization */}
      <TransferViz frame={frame} fps={fps} isComplete={isComplete} />

      {/* Bottom text */}
      <div style={{ height: 40, marginTop: 48 }}>
        {frame >= textStart && (
          <TextReveal
            text="Token transfers with hidden amounts"
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
        ShadowWire • C-SPL Tokens
      </div>
    </AbsoluteFill>
  );
};

/**
 * Token transfer visualization
 */
const TransferViz: React.FC<{
  frame: number;
  fps: number;
  isComplete: boolean;
}> = ({ frame, fps, isComplete }) => {
  const transferStart = 30;
  const transferDuration = 60;

  // Transfer progress
  const transferProgress = interpolate(
    frame,
    [transferStart, transferStart + transferDuration],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Wallets entrance
  const walletEntrance = spring({
    frame: frame - 20,
    fps,
    config: SPRINGS.snappy,
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 40,
        position: "relative",
      }}
    >
      {/* Sender wallet */}
      <WalletCard
        label="Seller"
        entrance={walletEntrance}
        isActive={transferProgress > 0}
        showDecrease={transferProgress > 0.3}
        isComplete={isComplete}
        side="sender"
      />

      {/* Transfer indicator */}
      <TransferArrow
        progress={transferProgress}
        isComplete={isComplete}
        frame={frame}
        fps={fps}
      />

      {/* Receiver wallet */}
      <WalletCard
        label="Buyer"
        entrance={walletEntrance}
        isActive={transferProgress > 0.5}
        showIncrease={transferProgress > 0.7}
        isComplete={isComplete}
        side="receiver"
      />
    </div>
  );
};

/**
 * Wallet card component
 */
const WalletCard: React.FC<{
  label: string;
  entrance: number;
  isActive: boolean;
  showDecrease?: boolean;
  showIncrease?: boolean;
  isComplete: boolean;
  side: "sender" | "receiver";
}> = ({
  label,
  entrance,
  isActive,
  showDecrease,
  showIncrease,
  isComplete,
  side,
}) => {
  const scale = interpolate(entrance, [0, 1], [0.8, 1]);
  const opacity = interpolate(entrance, [0, 1], [0, 1]);

  return (
    <div
      style={{
        width: 220,
        padding: 28,
        borderRadius: 20,
        backgroundColor: COLORS.surface[5],
        border: `2px solid ${
          isActive || isComplete ? COLORS.accent.privacy.full : COLORS.border.subtle
        }`,
        transform: `scale(${scale})`,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
        boxShadow:
          isActive || isComplete
            ? `0 0 30px ${COLORS.accent.privacy.full}25`
            : "none",
      }}
    >
      {/* Wallet icon */}
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          backgroundColor:
            side === "sender" ? COLORS.accent.sell.bg : COLORS.accent.buy.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Wallet
          size={32}
          weight="duotone"
          color={
            side === "sender"
              ? COLORS.accent.sell.text
              : COLORS.accent.buy.text
          }
        />
      </div>

      {/* Label */}
      <div
        style={{
          fontSize: 20,
          fontWeight: 500,
          color: COLORS.text.primary,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {label}
      </div>

      {/* Balance */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 18px",
          borderRadius: 10,
          backgroundColor: COLORS.surface[10],
        }}
      >
        <Lock size={16} color={COLORS.accent.privacy.full} />
        <span
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: COLORS.text.secondary,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          ••••••
        </span>
        <span
          style={{
            fontSize: 13,
            color: COLORS.text.muted,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          SOL
        </span>
      </div>

      {/* Change indicator */}
      <div
        style={{
          height: 24,
          display: "flex",
          alignItems: "center",
        }}
      >
        {(showDecrease || showIncrease) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 15,
              fontWeight: 500,
              color: showDecrease
                ? COLORS.accent.sell.text
                : COLORS.accent.buy.text,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            <EyeSlash size={16} />
            <span>{showDecrease ? "- ••••" : "+ ••••"}</span>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Transfer arrow with animated packet
 */
const TransferArrow: React.FC<{
  progress: number;
  isComplete: boolean;
  frame: number;
  fps: number;
}> = ({ progress, isComplete, frame, fps }) => {
  const arrowWidth = 180;
  const packetSize = 32;

  // Packet position - extends to full arrow width
  const packetX = interpolate(progress, [0, 1], [0, arrowWidth]);
  const packetOpacity = interpolate(
    progress,
    [0, 0.1, 0.9, 1],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const pulseValue = pulse(frame, fps, 2);

  return (
    <div
      style={{
        width: arrowWidth,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        position: "relative",
      }}
    >
      {/* Arrow line with gradient that fills as packet moves */}
      <div
        style={{
          width: "100%",
          height: 3,
          background: isComplete
            ? COLORS.accent.privacy.full
            : `linear-gradient(to right, ${COLORS.accent.privacy.full} 0%, ${COLORS.accent.privacy.full} ${progress * 100}%, ${COLORS.border.emphasis} ${progress * 100}%, ${COLORS.border.emphasis} 100%)`,
          borderRadius: 2,
          position: "relative",
        }}
      >
        {/* Animated packet */}
        {!isComplete && progress > 0 && progress < 1 && (
          <div
            style={{
              position: "absolute",
              left: packetX,
              top: "50%",
              transform: "translateY(-50%)",
              width: packetSize,
              height: packetSize,
              borderRadius: 8,
              backgroundColor: COLORS.accent.privacy.full,
              opacity: packetOpacity,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 ${12 + pulseValue * 12}px ${COLORS.accent.privacy.full}`,
            }}
          >
            <Lock size={16} weight="fill" color={COLORS.background} />
          </div>
        )}

        {/* Arrow head - turns green when progress reaches end */}
        <ArrowRight
          size={24}
          weight="bold"
          color={
            progress >= 0.95 || isComplete ? COLORS.accent.privacy.full : COLORS.border.emphasis
          }
          style={{
            position: "absolute",
            right: -12,
            top: "50%",
            transform: "translateY(-50%)",
          }}
        />
      </div>

      {/* Label */}
      <div
        style={{
          fontSize: 13,
          color: COLORS.text.muted,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <Lock size={14} />
        <span>Encrypted</span>
      </div>
    </div>
  );
};

export default Layer3Scene;
