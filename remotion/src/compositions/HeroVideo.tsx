/**
 * HeroVideo Composition
 * Main ~65 second marketing video
 *
 * Assembles all scenes with 1.5s fade transitions:
 * - IntroScene (8s / 240 frames)
 * - ProblemScene (6s / 180 frames)
 * - SolutionScene (7s / 210 frames)
 * - Layer1Scene (8s / 240 frames)
 * - Layer2Scene (10s / 300 frames)
 * - Layer3Scene (10s / 300 frames)
 * - DemoScene (10s / 300 frames)
 * - CTAScene (6s / 180 frames)
 *
 * Total: ~65s with transitions
 */

import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { COLORS, VIDEO, SCENE_FRAMES } from "../lib/constants";

// Import scenes
import { IntroScene } from "../scenes/IntroScene";
import { ProblemScene } from "../scenes/ProblemScene";
import { SolutionScene } from "../scenes/SolutionScene";
import { Layer1Scene } from "../scenes/Layer1Scene";
import { Layer2Scene } from "../scenes/Layer2Scene";
import { Layer3Scene } from "../scenes/Layer3Scene";
import { DemoScene } from "../scenes/DemoScene";
import { CTAScene } from "../scenes/CTAScene";

export const HeroVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Scene configuration with durations
  // Extended durations to prevent animation overlap during transitions
  // Each scene has ~1s fade-out built in, plus ~1.5s transition = need buffer time
  const scenes = [
    { Component: IntroScene, duration: 8 * fps, name: "Intro" },
    { Component: ProblemScene, duration: 6 * fps, name: "Problem" },   // Reduced from 9s
    { Component: SolutionScene, duration: 7 * fps, name: "Solution" }, // Reduced from 10s
    { Component: Layer1Scene, duration: 8 * fps, name: "Layer1" },
    { Component: Layer2Scene, duration: 10 * fps, name: "Layer2" },
    { Component: Layer3Scene, duration: 10 * fps, name: "Layer3" },
    { Component: DemoScene, duration: 10 * fps, name: "Demo" },
    { Component: CTAScene, duration: 6 * fps, name: "CTA" },
  ];

  const transitionDuration = 45; // 1.5 seconds for smoother crossfades with more overlap time

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
      }}
    >
      <TransitionSeries>
        {scenes.map((scene, index) => (
          <React.Fragment key={scene.name}>
            <TransitionSeries.Sequence durationInFrames={scene.duration}>
              <scene.Component />
            </TransitionSeries.Sequence>

            {index < scenes.length - 1 && (
              <TransitionSeries.Transition
                presentation={fade()}
                timing={linearTiming({ durationInFrames: transitionDuration })}
              />
            )}
          </React.Fragment>
        ))}
      </TransitionSeries>
    </AbsoluteFill>
  );
};

/**
 * Vertical version for TikTok/Reels/Shorts
 */
export const HeroVideoVertical: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Same scenes but with adjusted layouts for vertical
  const scenes = [
    { Component: IntroScene, duration: 8 * fps, name: "Intro" },
    { Component: ProblemScene, duration: 6 * fps, name: "Problem" },
    { Component: SolutionScene, duration: 7 * fps, name: "Solution" },
    { Component: Layer1Scene, duration: 8 * fps, name: "Layer1" },
    { Component: Layer2Scene, duration: 10 * fps, name: "Layer2" },
    { Component: Layer3Scene, duration: 10 * fps, name: "Layer3" },
    { Component: DemoScene, duration: 10 * fps, name: "Demo" },
    { Component: CTAScene, duration: 6 * fps, name: "CTA" },
  ];

  const transitionDuration = 45; // 1.5 seconds for smoother crossfades

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        // Scale down components for vertical view
        transform: "scale(0.8)",
        transformOrigin: "center center",
      }}
    >
      <TransitionSeries>
        {scenes.map((scene, index) => (
          <React.Fragment key={scene.name}>
            <TransitionSeries.Sequence durationInFrames={scene.duration}>
              <scene.Component />
            </TransitionSeries.Sequence>

            {index < scenes.length - 1 && (
              <TransitionSeries.Transition
                presentation={fade()}
                timing={linearTiming({ durationInFrames: transitionDuration })}
              />
            )}
          </React.Fragment>
        ))}
      </TransitionSeries>
    </AbsoluteFill>
  );
};

export default HeroVideo;
