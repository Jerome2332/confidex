/**
 * Root.tsx - Composition Registry
 *
 * Defines all video compositions for Confidex marketing videos
 */

import React from "react";
import { Composition, Folder } from "remotion";
import { VIDEO, DURATION } from "./lib/constants";

// Compositions
import { HeroVideo, HeroVideoVertical } from "./compositions/HeroVideo";

// Individual scenes (for preview/testing)
import { IntroScene } from "./scenes/IntroScene";
import { ProblemScene } from "./scenes/ProblemScene";
import { SolutionScene } from "./scenes/SolutionScene";
import { Layer1Scene } from "./scenes/Layer1Scene";
import { Layer2Scene } from "./scenes/Layer2Scene";
import { Layer3Scene } from "./scenes/Layer3Scene";
import { DemoScene } from "./scenes/DemoScene";
import { CTAScene } from "./scenes/CTAScene";

// Import styles
import "./style.css";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Main Compositions */}
      <Folder name="Main">
        <Composition
          id="HeroVideo"
          component={HeroVideo}
          durationInFrames={DURATION.HERO_VIDEO}
          fps={VIDEO.HORIZONTAL.fps}
          width={VIDEO.HORIZONTAL.width}
          height={VIDEO.HORIZONTAL.height}
          defaultProps={{}}
        />

        <Composition
          id="HeroVideoVertical"
          component={HeroVideoVertical}
          durationInFrames={DURATION.HERO_VIDEO}
          fps={VIDEO.VERTICAL.fps}
          width={VIDEO.VERTICAL.width}
          height={VIDEO.VERTICAL.height}
          defaultProps={{}}
        />
      </Folder>

      {/* Individual Scenes (for development/preview) */}
      <Folder name="Scenes">
        <Composition
          id="IntroScene"
          component={IntroScene}
          durationInFrames={8 * 30}
          fps={30}
          width={VIDEO.HORIZONTAL.width}
          height={VIDEO.HORIZONTAL.height}
          defaultProps={{}}
        />

        <Composition
          id="ProblemScene"
          component={ProblemScene}
          durationInFrames={6 * 30}
          fps={30}
          width={VIDEO.HORIZONTAL.width}
          height={VIDEO.HORIZONTAL.height}
          defaultProps={{}}
        />

        <Composition
          id="SolutionScene"
          component={SolutionScene}
          durationInFrames={7 * 30}
          fps={30}
          width={VIDEO.HORIZONTAL.width}
          height={VIDEO.HORIZONTAL.height}
          defaultProps={{}}
        />

        <Composition
          id="Layer1Scene"
          component={Layer1Scene}
          durationInFrames={8 * 30}
          fps={30}
          width={VIDEO.HORIZONTAL.width}
          height={VIDEO.HORIZONTAL.height}
          defaultProps={{}}
        />

        <Composition
          id="Layer2Scene"
          component={Layer2Scene}
          durationInFrames={10 * 30}
          fps={30}
          width={VIDEO.HORIZONTAL.width}
          height={VIDEO.HORIZONTAL.height}
          defaultProps={{}}
        />

        <Composition
          id="Layer3Scene"
          component={Layer3Scene}
          durationInFrames={10 * 30}
          fps={30}
          width={VIDEO.HORIZONTAL.width}
          height={VIDEO.HORIZONTAL.height}
          defaultProps={{}}
        />

        <Composition
          id="DemoScene"
          component={DemoScene}
          durationInFrames={10 * 30}
          fps={30}
          width={VIDEO.HORIZONTAL.width}
          height={VIDEO.HORIZONTAL.height}
          defaultProps={{}}
        />

        <Composition
          id="CTAScene"
          component={CTAScene}
          durationInFrames={6 * 30}
          fps={30}
          width={VIDEO.HORIZONTAL.width}
          height={VIDEO.HORIZONTAL.height}
          defaultProps={{}}
        />
      </Folder>

      {/* Social Media Clips */}
      <Folder name="Social">
        {/* Twitter/X format */}
        <Composition
          id="TwitterClip"
          component={IntroScene}
          durationInFrames={DURATION.SOCIAL_CLIP}
          fps={VIDEO.TWITTER.fps}
          width={VIDEO.TWITTER.width}
          height={VIDEO.TWITTER.height}
          defaultProps={{}}
        />

        {/* TikTok/Reels vertical */}
        <Composition
          id="TikTokClip"
          component={IntroScene}
          durationInFrames={DURATION.SOCIAL_CLIP}
          fps={VIDEO.VERTICAL.fps}
          width={VIDEO.VERTICAL.width}
          height={VIDEO.VERTICAL.height}
          defaultProps={{}}
        />
      </Folder>
    </>
  );
};
