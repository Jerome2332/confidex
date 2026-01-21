/**
 * Constants for Confidex Marketing Videos
 * Matches frontend design system from BRAND_GUIDELINES.md
 */

// Video Dimensions
export const VIDEO = {
  // Horizontal (16:9)
  HORIZONTAL: {
    width: 1920,
    height: 1080,
    fps: 30,
  },
  // Vertical (9:16) for TikTok/Reels/Shorts
  VERTICAL: {
    width: 1080,
    height: 1920,
    fps: 30,
  },
  // Twitter/X
  TWITTER: {
    width: 1280,
    height: 720,
    fps: 30,
  },
} as const;

// Durations in frames (at 30fps)
export const DURATION = {
  HERO_VIDEO: 65 * 30, // ~65 seconds = 1950 frames
  PRIVACY_EXPLAINER: 45 * 30,
  TRADING_DEMO: 30 * 30,
  SOCIAL_CLIP: 15 * 30,
} as const;

// Scene durations for Hero Video (in frames at 30fps)
export const SCENE_FRAMES = {
  INTRO: { start: 0, duration: 8 * 30 }, // 0-8s
  PROBLEM: { start: 8 * 30, duration: 6 * 30 }, // 8-14s (reduced)
  SOLUTION: { start: 14 * 30, duration: 7 * 30 }, // 14-21s (reduced)
  LAYER_1: { start: 21 * 30, duration: 8 * 30 }, // 21-29s
  LAYER_2: { start: 29 * 30, duration: 10 * 30 }, // 29-39s
  LAYER_3: { start: 39 * 30, duration: 10 * 30 }, // 39-49s
  DEMO: { start: 49 * 30, duration: 10 * 30 }, // 49-59s
  CTA: { start: 59 * 30, duration: 6 * 30 }, // 59-65s
} as const;

// Colors - matches frontend design system
export const COLORS = {
  background: "#000000",
  surface: {
    5: "rgba(255,255,255,0.05)",
    10: "rgba(255,255,255,0.10)",
    20: "rgba(255,255,255,0.20)",
  },
  text: {
    primary: "#FFFFFF",
    secondary: "rgba(255,255,255,0.60)",
    muted: "rgba(255,255,255,0.40)",
  },
  border: {
    subtle: "rgba(255,255,255,0.10)",
    emphasis: "rgba(255,255,255,0.20)",
    strong: "rgba(255,255,255,0.30)",
  },
  accent: {
    buy: {
      bg: "rgba(16,185,129,0.20)",
      text: "rgba(52,211,153,0.80)",
      border: "rgba(16,185,129,0.30)",
      solid: "#10B981",
    },
    sell: {
      bg: "rgba(244,63,94,0.20)",
      text: "rgba(251,113,133,0.80)",
      border: "rgba(244,63,94,0.30)",
      solid: "#F43F5E",
    },
    privacy: {
      full: "#34D399", // emerald-400
      active: "#FFFFFF",
      complete: "#10B981", // emerald-500
    },
  },
} as const;

// Typography
export const TYPOGRAPHY = {
  hero: { size: 72, weight: 300, lineHeight: 1.1 },
  h1: { size: 56, weight: 300, lineHeight: 1.2 },
  h2: { size: 42, weight: 300, lineHeight: 1.3 },
  h3: { size: 32, weight: 400, lineHeight: 1.4 },
  body: { size: 24, weight: 300, lineHeight: 1.5 },
  bodyLarge: { size: 28, weight: 300, lineHeight: 1.5 },
  small: { size: 18, weight: 400, lineHeight: 1.5 },
  mono: { size: 18, weight: 400, lineHeight: 1.6 },
} as const;

// Spring animation presets (for Remotion spring())
export const SPRINGS = {
  // Basic presets
  smooth: { damping: 200 },
  snappy: { damping: 20, stiffness: 200 },
  bouncy: { damping: 8 },
  heavy: { damping: 15, stiffness: 80, mass: 2 },
  gentle: { damping: 30, stiffness: 100 },
  // Enhanced presets
  elastic: { mass: 0.5, damping: 8, stiffness: 300 }, // Playful bounce
  premium: { mass: 1, damping: 30, stiffness: 150 }, // Apple-like refinement
  sluggish: { mass: 3, damping: 20, stiffness: 60 }, // Heavy, luxurious
  popIn: { mass: 0.6, damping: 12, stiffness: 280 }, // Quick pop with slight overshoot
  settle: { mass: 1.2, damping: 25, stiffness: 120 }, // Settles into place
} as const;

// Timing presets (in frames)
export const TIMING = {
  fadeIn: 15,
  fadeOut: 15,
  slideIn: 20,
  slideOut: 15,
  sceneTransition: 30,
  textRevealPerChar: 2,
  staggerDelay: 5,
} as const;

// Easing functions for interpolate()
export const EASINGS = {
  // Standard easings
  easeOut: [0.33, 1, 0.68, 1] as [number, number, number, number],
  easeIn: [0.32, 0, 0.67, 0] as [number, number, number, number],
  easeInOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
  bounce: [0.68, -0.55, 0.27, 1.55] as [number, number, number, number],
  // Enhanced easings
  easeOutBack: [0.34, 1.56, 0.64, 1] as [number, number, number, number], // Overshoot effect
  easeOutExpo: [0.16, 1, 0.3, 1] as [number, number, number, number], // Fast start, slow end
  easeInOutQuart: [0.76, 0, 0.24, 1] as [number, number, number, number], // Sharp acceleration
  easeOutElastic: [0.22, 0.61, 0.36, 1] as [number, number, number, number], // Slight elastic
  smooth: [0.25, 0.1, 0.25, 1] as [number, number, number, number], // CSS ease equivalent
} as const;

// Layer labels for privacy architecture
export const PRIVACY_LAYERS = {
  layer1: {
    label: "Layer 1",
    title: "ZK Compliance",
    description: "Prove eligibility without revealing identity",
    tech: "Noir + Sunspot",
    color: COLORS.accent.privacy.full,
  },
  layer2: {
    label: "Layer 2",
    title: "MPC Matching",
    description: "Encrypted order comparison",
    tech: "Arcium Cerberus",
    color: COLORS.accent.privacy.full,
  },
  layer3: {
    label: "Layer 3",
    title: "Private Settlement",
    description: "Confidential token transfers",
    tech: "ShadowWire",
    color: COLORS.accent.privacy.full,
  },
} as const;

// Problem cards content
export const PROBLEMS = [
  {
    title: "MEV Extraction",
    description: "Bots extract value from your trades",
    icon: "Robot",
  },
  {
    title: "Front-Running",
    description: "Your orders are seen before execution",
    icon: "Clock",
  },
  {
    title: "Visible Orders",
    description: "Your strategy is exposed to everyone",
    icon: "Eye",
  },
] as const;

// Voiceover script segments (for timing reference)
export const VOICEOVER = {
  intro: "Your trades are being watched.",
  problem:
    "Every order you place on a DEX is visible. Bots front-run you. MEV extracts value. Your strategy is exposed.",
  solution:
    "Confidex changes everything. The first fully private DEX on Solana. Three layers of cryptographic protection.",
  layer1:
    "Layer one: Zero-knowledge proofs. Prove you're eligible without revealing who you are.",
  layer2:
    "Layer two: Encrypted matching. Your orders are compared without ever being decrypted. Not even by us.",
  layer3:
    "Layer three: Confidential settlement. Token transfers with hidden amounts.",
  demo: "Place orders in seconds. Watch your privacy in real-time. Full encryption, zero compromise.",
  cta: "Trade privately. Confidex. Live on Solana.",
} as const;
