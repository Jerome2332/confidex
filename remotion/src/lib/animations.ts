/**
 * Animation utilities for Remotion compositions
 * All animations use useCurrentFrame() - never CSS transitions
 */

import { interpolate, spring, Easing } from "remotion";
import { SPRINGS, TIMING, EASINGS } from "./constants";

/**
 * Fade in animation
 */
export function fadeIn(
  frame: number,
  startFrame: number = 0,
  duration: number = TIMING.fadeIn
): number {
  return interpolate(frame, [startFrame, startFrame + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/**
 * Fade out animation
 */
export function fadeOut(
  frame: number,
  startFrame: number,
  duration: number = TIMING.fadeOut
): number {
  return interpolate(frame, [startFrame, startFrame + duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/**
 * Slide in from direction
 */
export function slideIn(
  frame: number,
  fps: number,
  direction: "left" | "right" | "up" | "down" = "up",
  delay: number = 0
): { x: number; y: number; opacity: number } {
  const progress = spring({
    frame: frame - delay,
    fps,
    config: SPRINGS.snappy,
  });

  const offsets = {
    left: { x: -100, y: 0 },
    right: { x: 100, y: 0 },
    up: { x: 0, y: 50 },
    down: { x: 0, y: -50 },
  };

  const offset = offsets[direction];

  return {
    x: interpolate(progress, [0, 1], [offset.x, 0]),
    y: interpolate(progress, [0, 1], [offset.y, 0]),
    opacity: interpolate(progress, [0, 0.5, 1], [0, 1, 1]),
  };
}

/**
 * Scale animation with spring
 */
export function scaleSpring(
  frame: number,
  fps: number,
  delay: number = 0,
  config: keyof typeof SPRINGS = "snappy"
): number {
  return spring({
    frame: frame - delay,
    fps,
    config: SPRINGS[config],
  });
}

/**
 * Typewriter text reveal - returns number of characters to show
 */
export function typewriter(
  frame: number,
  textLength: number,
  startFrame: number = 0,
  charsPerFrame: number = 0.5
): number {
  const elapsed = Math.max(0, frame - startFrame);
  return Math.min(Math.floor(elapsed * charsPerFrame), textLength);
}

/**
 * Staggered animation for lists
 */
export function stagger(
  frame: number,
  fps: number,
  index: number,
  delayPerItem: number = TIMING.staggerDelay
): number {
  return spring({
    frame: frame - index * delayPerItem,
    fps,
    config: SPRINGS.snappy,
  });
}

/**
 * Pulse animation (for active states)
 */
export function pulse(frame: number, fps: number, speed: number = 1): number {
  const cycle = (frame * speed) / fps;
  return 0.5 + 0.5 * Math.sin(cycle * Math.PI * 2);
}

/**
 * Glow intensity animation
 */
export function glow(
  frame: number,
  fps: number,
  minIntensity: number = 0.3,
  maxIntensity: number = 1
): number {
  const p = pulse(frame, fps, 0.5);
  return interpolate(p, [0, 1], [minIntensity, maxIntensity]);
}

/**
 * Progress bar animation
 */
export function progressBar(
  frame: number,
  startFrame: number,
  endFrame: number,
  easing: "linear" | "easeOut" | "easeIn" | "easeInOut" = "easeOut"
): number {
  const easingFn =
    easing === "linear"
      ? undefined
      : {
          easing: Easing.bezier(...EASINGS[easing]),
        };

  return interpolate(frame, [startFrame, endFrame], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    ...easingFn,
  });
}

/**
 * Rotation animation (for loading spinners)
 */
export function rotate(frame: number, fps: number, rpm: number = 60): number {
  return (frame / fps) * (rpm / 60) * 360;
}

/**
 * Data packet movement along path
 */
export function dataPacketProgress(
  frame: number,
  startFrame: number,
  duration: number
): number {
  return interpolate(frame, [startFrame, startFrame + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...EASINGS.easeInOut),
  });
}

/**
 * Shake animation (for problem cards)
 */
export function shake(
  frame: number,
  startFrame: number,
  duration: number = 30,
  intensity: number = 5
): { x: number; y: number } {
  const progress = interpolate(
    frame,
    [startFrame, startFrame + duration],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  if (progress <= 0) return { x: 0, y: 0 };

  const frequency = 20;
  const elapsed = frame - startFrame;
  const x =
    Math.sin(elapsed * frequency * 0.1) * intensity * progress * Math.random();
  const y =
    Math.cos(elapsed * frequency * 0.15) *
    intensity *
    0.5 *
    progress *
    Math.random();

  return { x, y };
}

/**
 * Glitch effect offset
 */
export function glitch(
  frame: number,
  startFrame: number,
  duration: number = 15
): { x: number; opacity: number; clipPath: string } {
  const elapsed = frame - startFrame;
  if (elapsed < 0 || elapsed > duration) {
    return { x: 0, opacity: 1, clipPath: "none" };
  }

  const intensity = Math.random() > 0.5 ? 1 : 0;
  const x = intensity * (Math.random() * 10 - 5);
  const opacity = intensity * 0.3 + 0.7;
  const y1 = Math.random() * 100;
  const y2 = y1 + Math.random() * 20;
  const clipPath = intensity
    ? `polygon(0 ${y1}%, 100% ${y1}%, 100% ${y2}%, 0 ${y2}%)`
    : "none";

  return { x, opacity, clipPath };
}

/**
 * Count up animation for numbers
 */
export function countUp(
  frame: number,
  startFrame: number,
  endFrame: number,
  startValue: number,
  endValue: number
): number {
  return Math.round(
    interpolate(frame, [startFrame, endFrame], [startValue, endValue], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(...EASINGS.easeOut),
    })
  );
}

/**
 * Bezier path interpolation for flowing data
 */
export function bezierPath(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): { x: number; y: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
  };
}

// ============================================================
// ENHANCED ANIMATION UTILITIES
// ============================================================

/**
 * Multi-layer glow effect - returns CSS box-shadow string
 * OPTIMIZED: Reduced to 2 layers for better performance
 */
export function multiLayerGlow(
  color: string,
  intensity: number = 1
): string {
  // Simple 2-layer glow: inner bright + outer soft
  const blur1 = Math.round(15 * intensity);
  const blur2 = Math.round(30 * intensity);
  return `0 0 ${blur1}px ${color}80, 0 0 ${blur2}px ${color}40`;
}

/**
 * Animated glow with pulse - returns CSS box-shadow string
 */
export function animatedGlow(
  frame: number,
  fps: number,
  color: string,
  minIntensity: number = 0.6,
  maxIntensity: number = 1.2,
  speed: number = 0.8
): string {
  const p = pulse(frame, fps, speed);
  const intensity = interpolate(p, [0, 1], [minIntensity, maxIntensity]);
  return multiLayerGlow(color, intensity);
}

/**
 * Wave stagger - creates a wave-like stagger pattern for list items
 */
export function waveStagger(
  frame: number,
  fps: number,
  index: number,
  totalItems: number,
  baseDelay: number = 5,
  waveAmplitude: number = 0.3
): number {
  // Add a sine wave offset to create a wave pattern
  const waveOffset = Math.sin((index / totalItems) * Math.PI) * waveAmplitude;
  const delay = baseDelay * index * (1 + waveOffset);

  return spring({
    frame: frame - delay,
    fps,
    config: SPRINGS.popIn,
  });
}

/**
 * 3D tilt effect - returns transform values for subtle 3D perspective
 */
export function tilt3D(
  frame: number,
  fps: number,
  startFrame: number = 0,
  maxTiltX: number = 5,
  maxTiltY: number = 8
): { rotateX: number; rotateY: number; perspective: number } {
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: SPRINGS.gentle,
  });

  // Subtle oscillation for dynamic feel
  const oscillation = Math.sin((frame / fps) * 2) * 0.3;

  return {
    rotateX: interpolate(progress, [0, 1], [maxTiltX, 0]) + oscillation,
    rotateY: interpolate(progress, [0, 1], [-maxTiltY, 0]) + oscillation * 0.5,
    perspective: 1000,
  };
}

/**
 * Screen shake - more intense than regular shake, affects entire viewport
 */
export function screenShake(
  frame: number,
  startFrame: number,
  duration: number = 30,
  intensity: number = 8
): { x: number; y: number; rotation: number } {
  const progress = interpolate(
    frame,
    [startFrame, startFrame + duration],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  if (progress <= 0) return { x: 0, y: 0, rotation: 0 };

  const elapsed = frame - startFrame;
  // Use deterministic noise instead of Math.random() for consistent renders
  const noise1 = Math.sin(elapsed * 0.7) * Math.cos(elapsed * 1.3);
  const noise2 = Math.cos(elapsed * 0.9) * Math.sin(elapsed * 1.1);
  const noise3 = Math.sin(elapsed * 1.5) * 0.5;

  return {
    x: noise1 * intensity * progress,
    y: noise2 * intensity * 0.8 * progress,
    rotation: noise3 * 2 * progress,
  };
}

/**
 * Particle generator - returns array of particle positions for a given frame
 */
export function generateParticles(
  frame: number,
  fps: number,
  count: number,
  bounds: { width: number; height: number },
  seed: number = 42
): Array<{ x: number; y: number; opacity: number; scale: number }> {
  const particles: Array<{
    x: number;
    y: number;
    opacity: number;
    scale: number;
  }> = [];

  for (let i = 0; i < count; i++) {
    // Deterministic "random" based on index and seed
    const hash = (i * 127 + seed) % 997;
    const baseX = (hash * 7.3) % bounds.width;
    const baseY = (hash * 11.7) % bounds.height;

    // Gentle floating motion
    const time = frame / fps;
    const floatX = Math.sin(time * 0.5 + i * 0.7) * 20;
    const floatY = Math.cos(time * 0.3 + i * 0.5) * 15;

    // Twinkling opacity
    const twinkle = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * 2 + i * 1.3));

    particles.push({
      x: baseX + floatX,
      y: baseY + floatY,
      opacity: twinkle,
      scale: 0.5 + ((hash % 100) / 100) * 0.5,
    });
  }

  return particles;
}

/**
 * Trail effect - returns array of positions for a trailing effect
 */
export function trail(
  currentX: number,
  currentY: number,
  frame: number,
  trailLength: number = 5,
  spacing: number = 3
): Array<{ x: number; y: number; opacity: number; scale: number }> {
  const positions: Array<{
    x: number;
    y: number;
    opacity: number;
    scale: number;
  }> = [];

  for (let i = 0; i < trailLength; i++) {
    // Each trail segment is slightly behind and fades out
    const offset = i * spacing;
    const progress = i / trailLength;

    positions.push({
      x: currentX - offset * Math.cos((frame * 0.1) % (Math.PI * 2)),
      y: currentY - offset * Math.sin((frame * 0.1) % (Math.PI * 2)),
      opacity: 1 - progress * 0.8,
      scale: 1 - progress * 0.5,
    });
  }

  return positions;
}

/**
 * Blur reveal - returns blur amount for text/element reveal
 */
export function blurReveal(
  frame: number,
  startFrame: number,
  duration: number = 20
): number {
  const progress = interpolate(
    frame,
    [startFrame, startFrame + duration],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(...EASINGS.easeOut),
    }
  );

  // Blur goes from 20px to 0px
  return interpolate(progress, [0, 1], [20, 0]);
}

/**
 * Scale pop with overshoot - element scales past 1 then settles
 */
export function scalePop(
  frame: number,
  fps: number,
  startFrame: number,
  overshoot: number = 1.15
): number {
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: SPRINGS.elastic,
  });

  // Map spring (which may overshoot) to scale
  return interpolate(
    progress,
    [0, 0.7, 1],
    [0, overshoot, 1],
    { extrapolateRight: "clamp" }
  );
}

/**
 * Node pulse - for network/connection visualizations
 */
export function nodePulse(
  frame: number,
  fps: number,
  triggerFrame: number,
  duration: number = 30
): { scale: number; glowIntensity: number } {
  if (frame < triggerFrame) {
    return { scale: 1, glowIntensity: 0.3 };
  }

  const elapsed = frame - triggerFrame;
  if (elapsed > duration) {
    return { scale: 1, glowIntensity: 0.3 };
  }

  const progress = elapsed / duration;
  // Quick scale up, slow settle
  const scale = 1 + 0.3 * Math.sin(progress * Math.PI) * (1 - progress);
  const glowIntensity = 0.3 + 0.7 * Math.sin(progress * Math.PI);

  return { scale, glowIntensity };
}

/**
 * Gradient position animation - for animated gradient backgrounds
 */
export function animatedGradientPosition(
  frame: number,
  fps: number,
  speed: number = 0.5
): { x: number; y: number } {
  const time = (frame / fps) * speed;
  return {
    x: 50 + 30 * Math.sin(time),
    y: 50 + 30 * Math.cos(time * 0.7),
  };
}

/**
 * Letter stagger - returns delay for each letter in a string
 */
export function letterStagger(
  index: number,
  totalLetters: number,
  baseDelay: number = 2,
  pattern: "linear" | "center" | "random" = "linear"
): number {
  switch (pattern) {
    case "center": {
      const center = totalLetters / 2;
      const distanceFromCenter = Math.abs(index - center);
      return distanceFromCenter * baseDelay;
    }
    case "random": {
      // Deterministic "random" based on index
      const hash = (index * 127) % 17;
      return index * baseDelay + hash;
    }
    default:
      return index * baseDelay;
  }
}
