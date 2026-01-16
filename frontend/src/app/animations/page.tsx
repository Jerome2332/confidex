'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Header } from '@/components/header';
import { CircleAnimationsGrid } from '@/components/circle-animations';
import { GriddyAnimation, GRIDDY_PALETTES } from '@/components/griddy-animation';
import { ArrowDown } from 'lucide-react';

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
            <ArrowDown className="h-5 w-5" />
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
