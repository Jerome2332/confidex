/**
 * DemoScene
 * UI walkthrough with animated trading panel matching the real frontend
 *
 * Timeline (240 frames / 8 seconds @ 30fps):
 * - 0-30: Trading UI slides in
 * - 30-60: Mouse cursor moves to Buy button
 * - 60-90: Click animation, OrderProgress appears
 * - 90-180: Progress through 4 steps
 * - 180-240: "Order Placed Privately" toast
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
  Audio,
  Sequence,
} from "remotion";
import {
  Shield,
  Lock,
  Lightning,
  CheckCircle,
  SpinnerGap,
  Cursor,
  Eye,
  ArrowsClockwise,
  TrendUp,
} from "@phosphor-icons/react";
import { COLORS, SPRINGS } from "../lib/constants";
import { pulse } from "../lib/animations";

// Token icon paths
const SOL_ICON = staticFile("coin-icons/SOL-logo.png");
const USDC_ICON = staticFile("coin-icons/USDC-logo.png");

// Sound effects
const SUCCESS_SFX = staticFile("audio/sfx/648212__philip_berger__ui-sounds-shimmering-success.wav");

export const DemoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Fade out at end of scene (last 15 frames = 0.5 seconds)
  const fadeOutStart = durationInFrames - 15;
  const fadeOut = interpolate(
    frame,
    [fadeOutStart, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  // UI entrance (delayed by 0.5s / 15 frames)
  const uiEntranceDelay = 15;
  const uiEntrance = spring({
    frame: frame - uiEntranceDelay,
    fps,
    config: SPRINGS.snappy,
  });
  const uiX = interpolate(uiEntrance, [0, 1], [100, 0]);
  const uiOpacity = interpolate(uiEntrance, [0, 1], [0, 1]);

  // Click timing
  const clickFrame = 60;
  const isClicked = frame >= clickFrame;

  // Progress steps timing
  const progressStart = 90;

  // Toast timing
  const toastStart = 200;
  const toastEntrance = spring({
    frame: frame - toastStart,
    fps,
    config: SPRINGS.bouncy,
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
        opacity: fadeOut,
      }}
    >
      {/* Mock Trading UI - fixed positions to prevent layout jumping */}
      <div
        style={{
          position: "relative",
          display: "flex",
          gap: 40,
          alignItems: "flex-start",
        }}
      >
        {/* Trading Panel - fixed width */}
        <div
          style={{
            transform: `translateX(${uiX}px)`,
            opacity: uiOpacity,
          }}
        >
          <MockTradingPanel
            frame={frame}
            fps={fps}
            isClicked={isClicked}
            clickFrame={clickFrame}
          />
        </div>

        {/* Order Progress - positioned absolutely to avoid layout shift */}
        <div
          style={{
            width: 280,
            opacity: isClicked ? 1 : 0,
            pointerEvents: isClicked ? "auto" : "none",
          }}
        >
          <OrderProgressPanel
            frame={frame}
            fps={fps}
            startFrame={progressStart}
          />
        </div>
      </div>

      {/* Success toast */}
      {frame >= toastStart && (
        <div
          style={{
            position: "absolute",
            bottom: 100,
            left: "50%",
            transform: `translateX(-50%) scale(${toastEntrance}) translateY(${interpolate(
              toastEntrance,
              [0, 1],
              [20, 0]
            )}px)`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 24px",
            borderRadius: 12,
            backgroundColor: `${COLORS.accent.privacy.full}20`,
            border: `2px solid ${COLORS.accent.privacy.full}`,
          }}
        >
          <CheckCircle
            size={28}
            weight="fill"
            color={COLORS.accent.privacy.full}
          />
          <span
            style={{
              fontSize: 20,
              fontWeight: 500,
              color: COLORS.text.primary,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            Order Placed Privately
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
};

/**
 * Mock trading panel - matches frontend/src/components/trading-panel.tsx
 */
const MockTradingPanel: React.FC<{
  frame: number;
  fps: number;
  isClicked: boolean;
  clickFrame: number;
}> = ({ frame, fps, isClicked, clickFrame }) => {
  // Button press animation
  const buttonPress = isClicked
    ? spring({
        frame: frame - clickFrame,
        fps,
        config: { damping: 15, stiffness: 300 },
      })
    : 0;

  const buttonScale = interpolate(buttonPress, [0, 0.5, 1], [1, 0.95, 1]);

  // Animated typing effect for amount
  const amountChars = "1.5";
  const typingStart = 15;
  const charsPerFrame = 0.15;
  const typedAmount = frame < typingStart
    ? ""
    : amountChars.slice(0, Math.floor((frame - typingStart) * charsPerFrame));

  return (
    <div
      style={{
        width: 340,
        borderRadius: 12,
        backgroundColor: COLORS.surface[5],
        border: `1px solid ${COLORS.border.subtle}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Order Type Tabs */}
      <div
        style={{
          display: "flex",
          borderBottom: `1px solid ${COLORS.border.subtle}`,
        }}
      >
        <div
          style={{
            flex: 1,
            padding: "10px 0",
            textAlign: "center",
            fontSize: 14,
            fontWeight: 500,
            color: COLORS.text.muted,
            borderBottom: "2px solid transparent",
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          Market
        </div>
        <div
          style={{
            flex: 1,
            padding: "10px 0",
            textAlign: "center",
            fontSize: 14,
            fontWeight: 500,
            color: COLORS.text.primary,
            borderBottom: `2px solid ${COLORS.accent.privacy.full}`,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          Limit
        </div>
      </div>

      {/* Token Selector */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: `1px solid ${COLORS.border.subtle}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Img
          src={SOL_ICON}
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 500, color: COLORS.text.primary, fontFamily: "'Inter', system-ui, sans-serif" }}>
          SOL
        </span>
        <TrendUp size={12} color={COLORS.accent.buy.text} />
        <span style={{ fontSize: 12, color: COLORS.accent.buy.text, fontFamily: "'JetBrains Mono', monospace" }}>
          $142.50
        </span>
      </div>

      {/* Buy/Sell Toggle */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "12px",
        }}
      >
        <div
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 6,
            backgroundColor: COLORS.accent.buy.bg,
            border: `1px solid ${COLORS.accent.buy.border}`,
            textAlign: "center",
            fontSize: 14,
            fontWeight: 500,
            color: COLORS.accent.buy.text,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          Buy
        </div>
        <div
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 6,
            backgroundColor: COLORS.surface[10],
            border: `1px solid ${COLORS.border.subtle}`,
            textAlign: "center",
            fontSize: 14,
            fontWeight: 400,
            color: COLORS.text.muted,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          Sell
        </div>
      </div>

      {/* Available to Trade */}
      <div
        style={{
          padding: "0 12px 4px",
          fontSize: 11,
          color: COLORS.text.muted,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        Available to Trade:{" "}
        <span style={{ color: COLORS.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
          213.75 USDC
        </span>
      </div>

      {/* Size Input */}
      <div style={{ padding: "8px 12px" }}>
        <div style={{ fontSize: 11, color: COLORS.text.muted, marginBottom: 4, fontFamily: "'Inter', system-ui, sans-serif" }}>
          Size
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 12px",
            borderRadius: 6,
            backgroundColor: COLORS.surface[10],
            border: `1px solid ${COLORS.border.subtle}`,
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 16,
              fontWeight: 500,
              color: COLORS.text.primary,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {typedAmount || "0.00"}
          </span>
          <span style={{ fontSize: 12, color: COLORS.text.muted, fontFamily: "'Inter', system-ui, sans-serif" }}>SOL</span>
        </div>

        {/* Percentage Slider */}
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              flex: 1,
              height: 4,
              backgroundColor: COLORS.surface[10],
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "50%",
                height: "100%",
                backgroundColor: COLORS.accent.privacy.full,
                borderRadius: 2,
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: COLORS.text.muted, width: 32, textAlign: "right", fontFamily: "'Inter', system-ui, sans-serif" }}>
            50%
          </span>
        </div>

        {/* Percentage Presets */}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginTop: 8,
          }}
        >
          {[25, 50, 75, 100].map((pct) => (
            <div
              key={pct}
              style={{
                flex: 1,
                padding: "4px 0",
                borderRadius: 4,
                border: `1px solid ${pct === 50 ? COLORS.accent.privacy.full : COLORS.border.subtle}`,
                backgroundColor: pct === 50 ? `${COLORS.accent.privacy.full}20` : "transparent",
                textAlign: "center",
                fontSize: 11,
                color: pct === 50 ? COLORS.accent.privacy.full : COLORS.text.muted,
                fontFamily: "'Inter', system-ui, sans-serif",
              }}
            >
              {pct}%
            </div>
          ))}
        </div>
      </div>

      {/* Price Input */}
      <div style={{ padding: "8px 12px" }}>
        <div style={{ fontSize: 11, color: COLORS.text.muted, marginBottom: 4, fontFamily: "'Inter', system-ui, sans-serif" }}>
          Price
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 12px",
            borderRadius: 6,
            backgroundColor: COLORS.surface[10],
            border: `1px solid ${COLORS.border.subtle}`,
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 16,
              fontWeight: 500,
              color: COLORS.text.primary,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            142.50
          </span>
          <span style={{ fontSize: 12, color: COLORS.text.muted, fontFamily: "'Inter', system-ui, sans-serif" }}>USDC</span>
        </div>
      </div>

      {/* Order Details */}
      <div style={{ padding: "8px 12px", fontSize: 11, fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ color: COLORS.text.muted }}>Order Value</span>
          <span style={{ color: COLORS.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
            $213.75
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ color: COLORS.text.muted }}>Slippage</span>
          <span style={{ color: COLORS.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
            Est: 0% / Max: 0.5%
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: COLORS.text.muted }}>Fees</span>
          <span style={{ color: COLORS.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
            0.07% / 0.04%
          </span>
        </div>
      </div>

      {/* Submit Button */}
      <div style={{ padding: "12px" }}>
        <div
          style={{
            padding: "12px 0",
            borderRadius: 8,
            backgroundColor: isClicked
              ? COLORS.accent.privacy.full
              : COLORS.accent.buy.bg,
            border: `1px solid ${isClicked ? COLORS.accent.privacy.full : COLORS.accent.buy.border}`,
            textAlign: "center",
            fontSize: 14,
            fontWeight: 600,
            color: isClicked ? COLORS.background : COLORS.accent.buy.text,
            fontFamily: "'Inter', system-ui, sans-serif",
            transform: `scale(${buttonScale})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          {isClicked ? (
            <>
              <SpinnerGap
                size={16}
                style={{ animation: "none", transform: `rotate(${frame * 8}deg)` }}
              />
              Processing...
            </>
          ) : (
            "Buy SOL"
          )}
        </div>
      </div>

      {/* Account Section */}
      <div
        style={{
          borderTop: `1px solid ${COLORS.border.subtle}`,
          padding: "12px",
        }}
      >
        {/* Wrap/Unwrap Buttons */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div
            style={{
              flex: 1,
              padding: "6px 0",
              borderRadius: 6,
              backgroundColor: `${COLORS.accent.privacy.full}10`,
              textAlign: "center",
              fontSize: 12,
              fontWeight: 500,
              color: COLORS.accent.privacy.full,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            Wrap
          </div>
          <div
            style={{
              flex: 1,
              padding: "6px 0",
              borderRadius: 6,
              backgroundColor: COLORS.surface[10],
              border: `1px solid ${COLORS.border.subtle}`,
              textAlign: "center",
              fontSize: 12,
              fontWeight: 500,
              color: COLORS.text.primary,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            Unwrap
          </div>
        </div>

        {/* Wallet Balance */}
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 11, color: COLORS.text.muted, fontFamily: "'Inter', system-ui, sans-serif" }}>Wallet Balance</span>
            <ArrowsClockwise size={12} color={COLORS.text.muted} />
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: COLORS.text.primary,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            $1,284.50
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 2, fontSize: 10, color: COLORS.text.muted }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>4.2500 SOL</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>650.00 USDC</span>
          </div>
        </div>

        {/* Trading Balance */}
        <div
          style={{
            paddingTop: 12,
            borderTop: `1px solid ${COLORS.border.subtle}`,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Lock size={12} color={COLORS.accent.privacy.full} />
              <span style={{ fontSize: 11, color: COLORS.text.muted, fontFamily: "'Inter', system-ui, sans-serif" }}>Trading Balance</span>
            </div>
            <Eye size={12} color={COLORS.text.muted} />
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: COLORS.text.primary,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            $213.75
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 2, fontSize: 10, color: COLORS.text.muted }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>0.0000 cSOL</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>213.75 cUSDC</span>
          </div>
        </div>

        {/* Privacy Status */}
        <div
          style={{
            marginTop: 12,
            paddingTop: 8,
            borderTop: `1px solid ${COLORS.border.subtle}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 10,
            color: COLORS.text.muted,
          }}
        >
          <span style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>Privacy: Encrypted</span>
          <span style={{ color: COLORS.accent.privacy.full, fontFamily: "'Inter', system-ui, sans-serif" }}>C-SPL Active</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Order progress panel
 */
const OrderProgressPanel: React.FC<{
  frame: number;
  fps: number;
  startFrame: number;
}> = ({ frame, fps, startFrame }) => {
  const steps = [
    { icon: Shield, label: "Generating Proof", duration: 25 },
    { icon: Lock, label: "Encrypting Order", duration: 20 },
    { icon: SpinnerGap, label: "Submitting", duration: 20 },
    { icon: Lightning, label: "MPC Queued", duration: 25 },
  ];

  const entrance = spring({
    frame: frame - startFrame + 10,
    fps,
    config: SPRINGS.snappy,
  });

  const panelX = interpolate(entrance, [0, 1], [50, 0]);
  const panelOpacity = interpolate(entrance, [0, 1], [0, 1]);

  // Calculate current step
  let elapsed = frame - startFrame;
  let currentStep = 0;
  let stepProgress = 0;

  for (let i = 0; i < steps.length; i++) {
    if (elapsed <= 0) break;
    if (elapsed < steps[i].duration) {
      currentStep = i;
      stepProgress = elapsed / steps[i].duration;
      break;
    }
    elapsed -= steps[i].duration;
    currentStep = i + 1;
  }

  return (
    <div
      style={{
        width: 280,
        padding: 24,
        borderRadius: 16,
        backgroundColor: COLORS.surface[5],
        border: `1px solid ${COLORS.border.subtle}`,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        transform: `translateX(${panelX}px)`,
        opacity: panelOpacity,
      }}
    >
      {/* Header */}
      <div
        style={{
          fontSize: 18,
          fontWeight: 500,
          color: COLORS.text.primary,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        Privacy Progress
      </div>

      {/* Steps */}
      {steps.map((step, index) => {
        const isComplete = currentStep > index;
        const isActive = currentStep === index;
        const Icon = step.icon;

        return (
          <StepRow
            key={step.label}
            icon={Icon}
            label={step.label}
            isComplete={isComplete}
            isActive={isActive}
            progress={isActive ? stepProgress : isComplete ? 1 : 0}
            frame={frame}
            fps={fps}
          />
        );
      })}
    </div>
  );
};

/**
 * Step row component
 */
const StepRow: React.FC<{
  icon: React.ElementType;
  label: string;
  isComplete: boolean;
  isActive: boolean;
  progress: number;
  frame: number;
  fps: number;
}> = ({ icon: Icon, label, isComplete, isActive, progress, frame, fps }) => {
  const pulseValue = isActive ? pulse(frame, fps, 2) : 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          backgroundColor: isComplete
            ? `${COLORS.accent.privacy.full}20`
            : isActive
            ? COLORS.surface[20]
            : COLORS.surface[10],
          border: `1px solid ${
            isComplete
              ? COLORS.accent.privacy.full
              : isActive
              ? COLORS.text.muted
              : COLORS.border.subtle
          }`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isComplete ? (
          <CheckCircle
            size={20}
            weight="fill"
            color={COLORS.accent.privacy.full}
          />
        ) : (
          <Icon
            size={18}
            weight={isActive ? "bold" : "regular"}
            color={isActive ? COLORS.text.primary : COLORS.text.muted}
            style={{
              opacity: isActive ? 0.5 + pulseValue * 0.5 : 1,
              transform:
                isActive && Icon === SpinnerGap
                  ? `rotate(${frame * 6}deg)`
                  : "none",
            }}
          />
        )}
      </div>

      {/* Label and progress */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: isActive ? 500 : 400,
            color: isComplete
              ? COLORS.accent.privacy.full
              : isActive
              ? COLORS.text.primary
              : COLORS.text.muted,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          {label}
        </div>
        {isActive && (
          <div
            style={{
              marginTop: 4,
              width: "100%",
              height: 4,
              backgroundColor: COLORS.surface[10],
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progress * 100}%`,
                height: "100%",
                backgroundColor: COLORS.text.secondary,
                borderRadius: 2,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Animated mouse cursor
 */
const MouseCursor: React.FC<{
  frame: number;
  fps: number;
  clickFrame: number;
}> = ({ frame, fps, clickFrame }) => {
  // Cursor movement
  const moveProgress = interpolate(frame, [20, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Start position (off screen right)
  // End position (on Buy button)
  const startX = 800;
  const startY = 500;
  const endX = 420;
  const endY = 480;

  const x = interpolate(moveProgress, [0, 1], [startX, endX]);
  const y = interpolate(moveProgress, [0, 1], [startY, endY]);

  // Click animation
  const isClicking = frame >= clickFrame && frame < clickFrame + 10;
  const clickScale = isClicking ? 0.8 : 1;

  // Hide after click
  if (frame > clickFrame + 30) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `scale(${clickScale})`,
        pointerEvents: "none",
        zIndex: 100,
      }}
    >
      <Cursor
        size={40}
        weight="fill"
        color={COLORS.text.primary}
        style={{
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
        }}
      />
    </div>
  );
};

export default DemoScene;
