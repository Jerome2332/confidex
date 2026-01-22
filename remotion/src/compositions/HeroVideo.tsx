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
  Audio,
  staticFile,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { COLORS, VIDEO, SCENE_FRAMES } from "../lib/constants";

// Audio configuration
const AUDIO_CONFIG = {
  // Background music - retro action groove loop
  backgroundMusic: "audio/sfx/273451__zagi2__retro-action-groove-2.wav",
  // Volume settings (0-1)
  musicVolume: 0.35,
  // Fade in/out duration in frames
  fadeInFrames: 30,  // 1 second fade in
  fadeOutFrames: 60, // 2 second fade out
  // Loop configuration
  trackDurationFrames: 480,  // 16 seconds at 30fps
  trimStartFrames: 15,       // 0.5 seconds trimmed from start of each loop (except first)
};

// Sound effects configuration
// Add these files to remotion/public/audio/sfx/
const SFX_CONFIG = {
  // Whoosh for scene transitions
  whoosh: { file: "audio/sfx/whoosh.mp3", volume: 0.5 },
  // Logo reveal sound
  logoReveal: { file: "audio/sfx/logo-reveal.mp3", volume: 0.6 },
  // UI click sound
  click: { file: "audio/sfx/click.mp3", volume: 0.4 },
  // Success/completion chime
  success: { file: "audio/sfx/success.mp3", volume: 0.5 },
  // Data/encryption sound
  dataProcess: { file: "audio/sfx/data-process.mp3", volume: 0.3 },
  // Lock/secure sound
  lock: { file: "audio/sfx/lock.mp3", volume: 0.4 },
  // Match found notification
  matchFound: { file: "audio/sfx/match-found.mp3", volume: 0.5 },
};

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
    { Component: Layer3Scene, duration: 8 * fps, name: "Layer3" },
    { Component: DemoScene, duration: 10 * fps, name: "Demo" },
    { Component: CTAScene, duration: 6 * fps, name: "CTA" },
  ];

  const transitionDuration = 15; // 0.5 seconds for snappy transitions

  // Audio volume with fade in/out
  const audioVolume = interpolate(
    frame,
    [0, AUDIO_CONFIG.fadeInFrames, durationInFrames - AUDIO_CONFIG.fadeOutFrames, durationInFrames],
    [0, AUDIO_CONFIG.musicVolume, AUDIO_CONFIG.musicVolume, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Calculate cumulative frame positions for each scene (accounting for transitions)
  const sceneStartFrames: number[] = [];
  let cumulativeFrame = 0;
  scenes.forEach((scene, index) => {
    sceneStartFrames.push(cumulativeFrame);
    cumulativeFrame += scene.duration - (index < scenes.length - 1 ? transitionDuration : 0);
  });

  // Sound effect trigger points (frame numbers)
  const sfxTriggers = {
    // IntroScene: Logo reveal at frame 30
    logoReveal: sceneStartFrames[0] + 30,
    // IntroScene: Badge pop at frame 130
    badgePop: sceneStartFrames[0] + 130,
    // Layer1Scene: ZK proof verification
    zkVerify: sceneStartFrames[3] + 120,
    // Layer2Scene: Match found at frame 150
    matchFound: sceneStartFrames[4] + 150,
    // Layer3Scene: Transfer complete at frame 120
    transferComplete: sceneStartFrames[5] + 120,
    // DemoScene: Button click at frame 60
    buttonClick: sceneStartFrames[6] + 75, // 60 + 15 delay
    // DemoScene: Toast success at frame 200
    orderSuccess: sceneStartFrames[6] + 215,
    // CTAScene: Final CTA
    ctaReveal: sceneStartFrames[7] + 30,
  };

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
      }}
    >
      {/* Background music - disabled for now */}

      {/* Sound Effects */}
      {/* Logo reveal whoosh */}
      <Sequence from={sfxTriggers.logoReveal}>
        <Audio src={staticFile(SFX_CONFIG.logoReveal.file)} volume={SFX_CONFIG.logoReveal.volume} />
      </Sequence>

      {/* Badge pop */}
      <Sequence from={sfxTriggers.badgePop}>
        <Audio src={staticFile(SFX_CONFIG.success.file)} volume={SFX_CONFIG.success.volume * 0.6} />
      </Sequence>

      {/* ZK verification sound */}
      <Sequence from={sfxTriggers.zkVerify}>
        <Audio src={staticFile(SFX_CONFIG.lock.file)} volume={SFX_CONFIG.lock.volume} />
      </Sequence>

      {/* MPC match found */}
      <Sequence from={sfxTriggers.matchFound}>
        <Audio src={staticFile(SFX_CONFIG.matchFound.file)} volume={SFX_CONFIG.matchFound.volume} />
      </Sequence>

      {/* Transfer complete */}
      <Sequence from={sfxTriggers.transferComplete}>
        <Audio src={staticFile(SFX_CONFIG.success.file)} volume={SFX_CONFIG.success.volume} />
      </Sequence>

      {/* Button click */}
      <Sequence from={sfxTriggers.buttonClick}>
        <Audio src={staticFile(SFX_CONFIG.click.file)} volume={SFX_CONFIG.click.volume} />
      </Sequence>

      {/* Order success toast */}
      <Sequence from={sfxTriggers.orderSuccess}>
        <Audio src={staticFile(SFX_CONFIG.success.file)} volume={SFX_CONFIG.success.volume} />
      </Sequence>

      {/* CTA reveal */}
      <Sequence from={sfxTriggers.ctaReveal}>
        <Audio src={staticFile(SFX_CONFIG.whoosh.file)} volume={SFX_CONFIG.whoosh.volume} />
      </Sequence>

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
    { Component: Layer3Scene, duration: 8 * fps, name: "Layer3" },
    { Component: DemoScene, duration: 10 * fps, name: "Demo" },
    { Component: CTAScene, duration: 6 * fps, name: "CTA" },
  ];

  const transitionDuration = 15; // 0.5 seconds for snappy transitions

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
