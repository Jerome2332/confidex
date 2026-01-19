'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Header } from '@/components/header';
import { CircleAnimationsGrid } from '@/components/circle-animations';
import { GriddyAnimation, GRIDDY_PALETTES } from '@/components/griddy-animation';
import { ASCIIGlitchDemo, ASCIIGlitchText } from '@/components/ascii-glitch-ripple';
import { ConicBorderAnimation, ConicBorderCard, CheckeredBackground } from '@/components/conic-border-animation';
import { FiberStreamAnimation, FIBER_STREAM_PRESETS } from '@/components/fiber-stream-animation';
import { ArrowDown } from '@phosphor-icons/react';

/**
 * Custom hook for scroll-triggered text reveal animation
 * Converts placeholder characters to actual text based on scroll progress
 */
function useScrollTextReveal(
  baseText: string,
  placeholderChar: string = '·'
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayText, setDisplayText] = useState('');
  const [progress, setProgress] = useState(0);

  // Create initial placeholder text matching base text structure
  const createPlaceholder = useCallback((text: string, char: string) => {
    return text
      .split('')
      .map((c) => (c === ' ' || c === '\u00A0' ? c : char))
      .join('');
  }, []);

  useEffect(() => {
    // Initialize with placeholder
    setDisplayText(createPlaceholder(baseText, placeholderChar));

    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const rect = container.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      // Calculate progress: start when center hits 90% of viewport, end at 35%
      const startThreshold = windowHeight * 0.9;
      const endThreshold = windowHeight * 0.35;
      const centerY = rect.top + rect.height / 2;

      let scrollProgress = 0;
      if (centerY <= startThreshold && centerY >= endThreshold) {
        scrollProgress = (startThreshold - centerY) / (startThreshold - endThreshold);
      } else if (centerY < endThreshold) {
        scrollProgress = 1;
      }

      scrollProgress = Math.max(0, Math.min(1, scrollProgress));
      setProgress(scrollProgress);

      // Update text based on progress
      const placeholder = createPlaceholder(baseText, placeholderChar);
      const offset = Math.round(scrollProgress * baseText.length);
      const newText =
        baseText.slice(0, offset) + placeholder.slice(offset, placeholder.length);
      setDisplayText(newText);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial check

    return () => window.removeEventListener('scroll', handleScroll);
  }, [baseText, placeholderChar, createPlaceholder]);

  return { containerRef, displayText, progress };
}

/**
 * ScrollTextReveal Component
 * Animated text that reveals from placeholder characters on scroll
 */
function ScrollTextReveal({
  text,
  placeholderChar = '·',
  className = '',
}: {
  text: string;
  placeholderChar?: string;
  className?: string;
}) {
  const { containerRef, displayText, progress } = useScrollTextReveal(
    text,
    placeholderChar
  );

  return (
    <div ref={containerRef} className="relative">
      {/* Hidden base text for accessibility and sizing */}
      <h2
        className={`opacity-0 ${className}`}
        aria-hidden="false"
      >
        {text}
      </h2>
      {/* Animated overlay text */}
      <p
        className={`absolute top-0 left-0 m-0 ${className}`}
        aria-hidden="true"
      >
        {displayText}
      </p>
      {/* Optional: Progress indicator for debugging */}
      {/* <span className="absolute -bottom-8 left-0 text-xs text-white/40">
        {Math.round(progress * 100)}%
      </span> */}
    </div>
  );
}

/**
 * Animations Example Page
 * Demonstrates scroll-triggered text reveal animation
 */
export default function AnimationsPage() {
  return (
    <main className="min-h-screen bg-black">
      <Header />

      {/* Intro Section */}
      <section className="min-h-[90vh] flex flex-col items-center justify-center px-4 py-20">
        <div className="text-center">
          <h1 className="text-4xl md:text-5xl font-light text-white mb-6">
            Animation Examples
          </h1>
          <p className="text-xl text-white/60 mb-8 max-w-2xl">
            A collection of clean, reusable animations for the Confidex UI.
            Scroll down to see them in action.
          </p>
          <div className="flex flex-col items-center gap-2 text-white/40 animate-bounce">
            <span className="text-sm">Scroll down</span>
            <ArrowDown size={20} />
          </div>
        </div>
      </section>

      {/* Text Reveal Animation Section */}
      <section className="min-h-[90vh] bg-black text-white flex items-center justify-center px-4 py-20">
        <div className="text-center">
          <ScrollTextReveal
            text="Privacy is built in."
            placeholderChar="·"
            className="text-5xl md:text-7xl font-light tracking-tight max-w-[5em] leading-tight"
          />
        </div>
      </section>

      {/* Second Example - Different text */}
      <section className="min-h-[90vh] bg-white/5 flex items-center justify-center px-4 py-20">
        <div className="text-center">
          <p className="text-sm text-white/40 mb-4 uppercase tracking-widest">
            Another example
          </p>
          <ScrollTextReveal
            text="Trade with confidence."
            placeholderChar="•"
            className="text-4xl md:text-6xl font-light text-white tracking-tight max-w-[8em] leading-tight"
          />
        </div>
      </section>

      {/* Third Example - Longer text */}
      <section className="min-h-[90vh] bg-black flex items-center justify-center px-4 py-20">
        <div className="text-center">
          <p className="text-sm text-white/40 mb-4 uppercase tracking-widest">
            Longer text example
          </p>
          <ScrollTextReveal
            text="Zero-knowledge proofs. Multi-party computation. Confidential tokens."
            placeholderChar="─"
            className="text-2xl md:text-4xl font-normal text-white tracking-tight max-w-[20em] leading-relaxed"
          />
        </div>
      </section>

      {/* Griddy Animation Section */}
      <section className="min-h-screen bg-white/5 py-20 px-4">
        <div className="container mx-auto">
          <h2 className="text-2xl md:text-3xl font-light text-white text-center mb-4">
            Griddy Animation
          </h2>
          <p className="text-white/60 text-center mb-12 max-w-2xl mx-auto">
            Canvas-based grid animation with fading cells and radial lighting. Configurable colors and cell sizes.
          </p>
          <div className="flex flex-wrap justify-center gap-8">
            <div className="flex flex-col items-center">
              <GriddyAnimation showPalette />
              <p className="text-white/80 text-sm mt-4 font-normal">Default (Blue)</p>
            </div>
            <div className="flex flex-col items-center">
              <GriddyAnimation colors={GRIDDY_PALETTES.purple} showPalette />
              <p className="text-white/80 text-sm mt-4 font-normal">Purple Palette</p>
            </div>
            <div className="flex flex-col items-center">
              <GriddyAnimation colors={GRIDDY_PALETTES.green} showPalette />
              <p className="text-white/80 text-sm mt-4 font-normal">Green Palette</p>
            </div>
            <div className="flex flex-col items-center">
              <GriddyAnimation colors={GRIDDY_PALETTES.monochrome} showPalette />
              <p className="text-white/80 text-sm mt-4 font-normal">Monochrome</p>
            </div>
          </div>
        </div>
      </section>

      {/* Circle Animations Section */}
      <section className="min-h-screen bg-black py-20 px-4">
        <div className="container mx-auto">
          <h2 className="text-2xl md:text-3xl font-light text-white text-center mb-4">
            Circle Animations Collection
          </h2>
          <p className="text-white/60 text-center mb-12 max-w-2xl mx-auto">
            Canvas-based 3D animations with hover interactions. Suitable for loading states, backgrounds, or visual accents.
          </p>
          <CircleAnimationsGrid />
        </div>
      </section>

      {/* Conic Border Animation Section */}
      <section className="min-h-screen bg-black py-20 px-4">
        <div className="container mx-auto">
          <h2 className="text-2xl md:text-3xl font-light text-white text-center mb-4">
            Conic Border Animation
          </h2>
          <p className="text-white/60 text-center mb-12 max-w-2xl mx-auto">
            Rotating conic gradient border using CSS @property animation.
            Creates a spotlight effect that sweeps around the border.
          </p>

          {/* Basic examples */}
          <div className="flex flex-wrap justify-center gap-8 mb-16">
            <div className="flex flex-col items-center">
              <ConicBorderAnimation width={200} height={200} borderRadius={24} duration={2}>
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-white/60 text-sm">Fast</span>
                </div>
              </ConicBorderAnimation>
              <p className="text-white/80 text-sm mt-4 font-normal">Fast (2s)</p>
            </div>
            <div className="flex flex-col items-center">
              <ConicBorderAnimation width={200} height={200} borderRadius={24}>
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-white/60 text-sm">Default</span>
                </div>
              </ConicBorderAnimation>
              <p className="text-white/80 text-sm mt-4 font-normal">Default (4s)</p>
            </div>
            <div className="flex flex-col items-center">
              <ConicBorderAnimation width={200} height={200} borderRadius={24} duration={6}>
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-white/60 text-sm">Slow</span>
                </div>
              </ConicBorderAnimation>
              <p className="text-white/80 text-sm mt-4 font-normal">Slow (6s)</p>
            </div>
            <div className="flex flex-col items-center">
              <ConicBorderAnimation width={200} height={200} borderRadius={100} duration={6}>
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-white/60 text-sm">Circle</span>
                </div>
              </ConicBorderAnimation>
              <p className="text-white/80 text-sm mt-4 font-normal">Circular (6s)</p>
            </div>
          </div>

          {/* Card example */}
          <div className="flex justify-center mb-16">
            <ConicBorderCard
              title="Confidex"
              description="Private. Secure. Fast."
              width={400}
              height={200}
            />
          </div>

          {/* With checkered background */}
          <p className="text-white/40 text-sm text-center mb-4 uppercase tracking-widest">
            With checkered background
          </p>
          <CheckeredBackground>
            <div className="py-16">
              <ConicBorderAnimation width={352} height={352} borderRadius={32}>
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-white text-lg font-light">Original Demo Style</p>
                    <p className="text-white/40 text-xs mt-2">352×352px • 32px radius</p>
                  </div>
                </div>
              </ConicBorderAnimation>
            </div>
          </CheckeredBackground>
        </div>
      </section>

      {/* ASCII Glitch Ripple Section */}
      <section className="min-h-screen bg-white/5 py-20 px-4">
        <div className="container mx-auto max-w-3xl">
          <h2 className="text-2xl md:text-3xl font-light text-white text-center mb-4">
            ASCII Glitch Ripple
          </h2>
          <p className="text-white/60 text-center mb-12 max-w-2xl mx-auto">
            Hover effect that creates rippling waves of ASCII characters following cursor movement.
            Based on Bastien Cornier&apos;s research.
          </p>

          {/* Demo heading */}
          <div className="text-center mb-16">
            <ASCIIGlitchText
              as="h3"
              className="text-3xl md:text-5xl font-light text-white cursor-pointer inline-block"
              duration={800}
              spread={0.5}
            >
              Hover over this text
            </ASCIIGlitchText>
          </div>

          {/* Demo list styled like the original */}
          <div className="ascii-demo-container">
            <style jsx global>{`
              .ascii-glitch-list {
                list-style: none;
                padding: 0;
                margin: 0;
              }
              .ascii-glitch-item {
                margin: 0.8rem 0;
                position: relative;
                padding-left: 1rem;
              }
              .ascii-glitch-item::before {
                content: "";
                position: absolute;
                left: 0;
                top: 50%;
                width: 0.5rem;
                height: 1px;
                background: #f9f9f7;
                transform: scaleX(1);
                transform-origin: right;
                transition: transform 0.3s ease;
              }
              .ascii-glitch-item:hover::before {
                transform: scaleX(2);
              }
              .ascii-glitch-link {
                color: #f9f9f7;
                text-decoration: none;
                font-family: "Lucida Console", Monaco, monospace;
                font-size: 14px;
                letter-spacing: 0.01em;
                cursor: pointer;
                user-select: none;
                display: inline-block;
                margin-left: 0.5rem;
                white-space: nowrap;
              }
              .ascii-glitch-text {
                cursor: pointer;
                user-select: none;
                white-space: nowrap;
                display: inline-block;
              }
              .ascii-glitch-active {
                cursor: pointer;
              }
              .ascii-glitch-active::selection {
                background: transparent;
              }
            `}</style>

            <ASCIIGlitchDemo
              items={[
                'Roadside Picnic — Arkady & Boris Strugatsky',
                'The City & the City — China Miéville',
                'Parable of the Sower — Octavia E. Butler',
                'The Fifth Head of Cerberus — Gene Wolfe',
                'Riddley Walker — Russell Hoban',
                'His Master\'s Voice — Stanisław Lem',
                'The Left Hand of Darkness — Ursula K. Le Guin',
                'The Three Stigmata of Palmer Eldritch — Philip K. Dick',
              ]}
              duration={1000}
              spread={1}
            />
          </div>
        </div>
      </section>

      {/* Fiber Stream Animation Section */}
      <section className="min-h-screen bg-black py-20 px-4">
        <div className="container mx-auto">
          <h2 className="text-2xl md:text-3xl font-light text-white text-center mb-4">
            Fiber Stream Animation
          </h2>
          <p className="text-white/60 text-center mb-12 max-w-2xl mx-auto">
            Three.js fiber optic visualization with bloom effects and animated data signals.
            Represents encrypted data flowing through the network.
          </p>

          {/* Full width default */}
          <div className="mb-16">
            <p className="text-white/40 text-sm text-center mb-4 uppercase tracking-widest">
              Default Configuration
            </p>
            <div className="rounded-2xl overflow-hidden border border-white/10">
              <FiberStreamAnimation height={400} />
            </div>
          </div>

          {/* Preset variations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
            <div className="flex flex-col">
              <div className="rounded-xl overflow-hidden border border-white/10">
                <FiberStreamAnimation
                  height={300}
                  config={FIBER_STREAM_PRESETS.privacy}
                />
              </div>
              <p className="text-white/80 text-sm mt-4 font-normal text-center">Privacy (Emerald)</p>
            </div>
            <div className="flex flex-col">
              <div className="rounded-xl overflow-hidden border border-white/10">
                <FiberStreamAnimation
                  height={300}
                  config={FIBER_STREAM_PRESETS.multicolor}
                />
              </div>
              <p className="text-white/80 text-sm mt-4 font-normal text-center">Multicolor</p>
            </div>
            <div className="flex flex-col">
              <div className="rounded-xl overflow-hidden border border-white/10">
                <FiberStreamAnimation
                  height={300}
                  config={FIBER_STREAM_PRESETS.dense}
                />
              </div>
              <p className="text-white/80 text-sm mt-4 font-normal text-center">Dense</p>
            </div>
            <div className="flex flex-col">
              <div className="rounded-xl overflow-hidden border border-white/10">
                <FiberStreamAnimation
                  height={300}
                  config={FIBER_STREAM_PRESETS.minimal}
                />
              </div>
              <p className="text-white/80 text-sm mt-4 font-normal text-center">Minimal</p>
            </div>
          </div>

          {/* Wide variant */}
          <div>
            <p className="text-white/40 text-sm text-center mb-4 uppercase tracking-widest">
              Wide Configuration
            </p>
            <div className="rounded-2xl overflow-hidden border border-white/10">
              <FiberStreamAnimation
                height={350}
                config={FIBER_STREAM_PRESETS.wide}
              />
            </div>
          </div>
        </div>
      </section>

      {/* End Section */}
      <section className="min-h-[50vh] flex items-center justify-center px-4 py-20 border-t border-white/10">
        <div className="text-center">
          <h2 className="text-2xl font-light text-white mb-4">
            You&apos;ve reached the end
          </h2>
          <p className="text-white/60">
            These animations can be customized and reused throughout the app.
          </p>
        </div>
      </section>
    </main>
  );
}
