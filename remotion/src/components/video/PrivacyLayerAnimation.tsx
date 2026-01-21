/**
 * PrivacyLayerAnimation Component
 * Animated 3-layer privacy architecture visualization
 *
 * Displays the three privacy layers:
 * - Layer 1: ZK Proofs (Noir + Sunspot)
 * - Layer 2: MPC Matching (Arcium Cerberus)
 * - Layer 3: Private Settlement (ShadowWire)
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Sequence,
} from "remotion";
import {
  Shield,
  Lock,
  Lightning,
  CheckCircle,
  ArrowRight,
} from "@phosphor-icons/react";
import { COLORS, SPRINGS, PRIVACY_LAYERS } from "../../lib/constants";
import { fadeIn, pulse } from "../../lib/animations";

interface PrivacyLayerAnimationProps {
  activeLayer?: 0 | 1 | 2 | 3; // 0 = none, 1-3 = specific layer
  showConnections?: boolean;
  variant?: "horizontal" | "vertical" | "stacked";
  size?: "small" | "medium" | "large";
}

export const PrivacyLayerAnimation: React.FC<PrivacyLayerAnimationProps> = ({
  activeLayer = 0,
  showConnections = true,
  variant = "horizontal",
  size = "medium",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sizes = {
    small: { box: 120, icon: 32, text: 14, gap: 40 },
    medium: { box: 180, icon: 48, text: 18, gap: 60 },
    large: { box: 240, icon: 64, text: 24, gap: 80 },
  };

  const s = sizes[size];

  const layers = [
    {
      ...PRIVACY_LAYERS.layer1,
      icon: Shield,
    },
    {
      ...PRIVACY_LAYERS.layer2,
      icon: Lock,
    },
    {
      ...PRIVACY_LAYERS.layer3,
      icon: Lightning,
    },
  ];

  const isVertical = variant === "vertical" || variant === "stacked";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isVertical ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        position: "relative",
      }}
    >
      {layers.map((layer, index) => {
        const layerNumber = index + 1;
        const isActive = activeLayer === layerNumber || activeLayer === 0;
        const isCurrentlyActive = activeLayer === layerNumber;

        // Stagger entrance animation
        const entranceDelay = index * 15;
        const entrance = spring({
          frame: frame - entranceDelay,
          fps,
          config: SPRINGS.snappy,
        });

        const scale = interpolate(entrance, [0, 1], [0.8, 1]);
        const opacity = interpolate(entrance, [0, 1], [0, isActive ? 1 : 0.3]);

        // Pulse effect for active layer
        const pulseValue = isCurrentlyActive ? pulse(frame, fps, 0.8) : 0;
        const glowIntensity = interpolate(pulseValue, [0, 1], [0.3, 0.8]);

        const Icon = layer.icon;

        return (
          <React.Fragment key={layer.label}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                opacity,
                transform: `scale(${scale})`,
              }}
            >
              {/* Layer box */}
              <div
                style={{
                  width: s.box,
                  height: s.box,
                  borderRadius: 16,
                  backgroundColor: COLORS.surface[10],
                  border: `2px solid ${
                    isCurrentlyActive
                      ? layer.color
                      : COLORS.border.subtle
                  }`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  boxShadow: isCurrentlyActive
                    ? `0 0 ${30 * glowIntensity}px ${layer.color}40`
                    : "none",
                  transition: "box-shadow 0.3s",
                }}
              >
                {/* Icon */}
                <Icon
                  size={s.icon}
                  weight={isCurrentlyActive ? "fill" : "regular"}
                  color={isCurrentlyActive ? layer.color : COLORS.text.secondary}
                />

                {/* Layer label */}
                <div
                  style={{
                    fontSize: s.text * 0.8,
                    fontWeight: 500,
                    color: COLORS.text.muted,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    fontFamily: "'Inter', system-ui, sans-serif",
                  }}
                >
                  {layer.label}
                </div>

                {/* Title */}
                <div
                  style={{
                    fontSize: s.text,
                    fontWeight: 400,
                    color: isCurrentlyActive ? layer.color : COLORS.text.primary,
                    textAlign: "center",
                    fontFamily: "'Inter', system-ui, sans-serif",
                  }}
                >
                  {layer.title}
                </div>
              </div>

              {/* Tech badge */}
              <div
                style={{
                  marginTop: 12,
                  padding: "4px 12px",
                  borderRadius: 999,
                  backgroundColor: COLORS.surface[5],
                  fontSize: s.text * 0.7,
                  color: COLORS.text.muted,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {layer.tech}
              </div>
            </div>

            {/* Connection arrow */}
            {showConnections && index < layers.length - 1 && (
              <ConnectionArrow
                frame={frame}
                fps={fps}
                delay={entranceDelay + 10}
                isActive={activeLayer === 0 || activeLayer > layerNumber}
                isVertical={isVertical}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

/**
 * Connection arrow between layers
 */
interface ConnectionArrowProps {
  frame: number;
  fps: number;
  delay: number;
  isActive: boolean;
  isVertical: boolean;
}

const ConnectionArrow: React.FC<ConnectionArrowProps> = ({
  frame,
  fps,
  delay,
  isActive,
  isVertical,
}) => {
  const entrance = spring({
    frame: frame - delay,
    fps,
    config: SPRINGS.snappy,
  });

  const scale = interpolate(entrance, [0, 1], [0, 1]);
  const opacity = interpolate(entrance, [0, 1], [0, isActive ? 0.6 : 0.2]);

  return (
    <div
      style={{
        transform: isVertical ? "rotate(90deg)" : "none",
        opacity,
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 40,
          height: 2,
          backgroundColor: COLORS.border.emphasis,
          transform: `scaleX(${scale})`,
          transformOrigin: "left center",
        }}
      />
      <ArrowRight
        size={20}
        color={COLORS.text.muted}
        style={{
          opacity: scale,
          marginLeft: -4,
        }}
      />
    </div>
  );
};

/**
 * Single layer detail view
 */
interface LayerDetailProps {
  layer: 1 | 2 | 3;
  showDescription?: boolean;
  showProgress?: boolean;
  progress?: number;
}

export const LayerDetail: React.FC<LayerDetailProps> = ({
  layer,
  showDescription = true,
  showProgress = false,
  progress = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const layerData = [PRIVACY_LAYERS.layer1, PRIVACY_LAYERS.layer2, PRIVACY_LAYERS.layer3][
    layer - 1
  ];
  const Icon = [Shield, Lock, Lightning][layer - 1];

  const entrance = spring({
    frame,
    fps,
    config: SPRINGS.snappy,
  });

  const scale = interpolate(entrance, [0, 1], [0.9, 1]);
  const opacity = interpolate(entrance, [0, 1], [0, 1]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      {/* Large icon */}
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: 24,
          backgroundColor: `${layerData.color}20`,
          border: `2px solid ${layerData.color}40`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={64} weight="duotone" color={layerData.color} />
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 36,
          fontWeight: 300,
          color: COLORS.text.primary,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {layerData.title}
      </div>

      {/* Description */}
      {showDescription && (
        <div
          style={{
            fontSize: 24,
            fontWeight: 300,
            color: COLORS.text.secondary,
            textAlign: "center",
            maxWidth: 500,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          {layerData.description}
        </div>
      )}

      {/* Progress bar */}
      {showProgress && (
        <div
          style={{
            width: 300,
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
              backgroundColor: layerData.color,
              borderRadius: 4,
            }}
          />
        </div>
      )}

      {/* Tech badge */}
      <div
        style={{
          padding: "8px 16px",
          borderRadius: 999,
          backgroundColor: COLORS.surface[5],
          fontSize: 16,
          color: COLORS.text.muted,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {layerData.tech}
      </div>
    </div>
  );
};

/**
 * Animated data flow between layers
 */
export const DataFlowAnimation: React.FC<{
  fromLayer: 1 | 2 | 3;
  toLayer: 1 | 2 | 3;
}> = ({ fromLayer, toLayer }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Looping animation
  const cycleDuration = fps * 2; // 2 seconds per cycle
  const cycleProgress = (frame % cycleDuration) / cycleDuration;

  const particles = [0, 0.2, 0.4, 0.6, 0.8];

  return (
    <div
      style={{
        position: "absolute",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      {particles.map((offset, index) => {
        const particleProgress = (cycleProgress + offset) % 1;

        return (
          <div
            key={index}
            style={{
              position: "absolute",
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: COLORS.accent.privacy.full,
              left: `${20 + particleProgress * 60}%`,
              top: "50%",
              transform: "translateY(-50%)",
              opacity: interpolate(particleProgress, [0, 0.1, 0.9, 1], [0, 1, 1, 0]),
              boxShadow: `0 0 10px ${COLORS.accent.privacy.full}`,
            }}
          />
        );
      })}
    </div>
  );
};

export default PrivacyLayerAnimation;
