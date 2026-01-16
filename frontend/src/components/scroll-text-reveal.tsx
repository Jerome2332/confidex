'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Custom hook for scroll-triggered text reveal animation
 * Converts placeholder characters to actual text based on scroll progress
 */
export function useScrollTextReveal(
  baseText: string,
  placeholderChar: string = '·',
  options?: {
    startThreshold?: number; // viewport percentage where animation starts (default 0.9 = 90%)
    endThreshold?: number; // viewport percentage where animation ends (default 0.35 = 35%)
  }
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayText, setDisplayText] = useState('');
  const [progress, setProgress] = useState(0);

  const startThresholdPercent = options?.startThreshold ?? 0.9;
  const endThresholdPercent = options?.endThreshold ?? 0.35;

  // Create initial placeholder text matching base text structure
  const createPlaceholder = useCallback((text: string, char: string) => {
    return text
      .split('')
      .map((c) => (c === ' ' || c === '\u00A0' || c === '\n' ? c : char))
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

      // Calculate progress based on thresholds
      const startThreshold = windowHeight * startThresholdPercent;
      const endThreshold = windowHeight * endThresholdPercent;
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
  }, [baseText, placeholderChar, createPlaceholder, startThresholdPercent, endThresholdPercent]);

  return { containerRef, displayText, progress };
}

/**
 * ScrollTextReveal Component
 * Animated text that reveals from placeholder characters on scroll
 */
export function ScrollTextReveal({
  text,
  placeholderChar = '·',
  className = '',
  as: Component = 'h2',
  startThreshold,
  endThreshold,
}: {
  text: string;
  placeholderChar?: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span';
  startThreshold?: number;
  endThreshold?: number;
}) {
  const { containerRef, displayText } = useScrollTextReveal(text, placeholderChar, {
    startThreshold,
    endThreshold,
  });

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Hidden base text for accessibility and sizing */}
      <Component className={`opacity-0 ${className}`} aria-hidden="false">
        {text}
      </Component>
      {/* Animated overlay text */}
      <span
        className={`absolute top-0 left-0 ${className}`}
        aria-hidden="true"
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {displayText}
      </span>
    </div>
  );
}

/**
 * HeroTextReveal Component
 * Specialized version for hero sections with multi-line support and gradient text
 */
export function HeroTextReveal({
  line1,
  line2,
  placeholderChar = '·',
  className = '',
  line1ClassName = '',
  line2ClassName = '',
  startThreshold = 0.95,
  endThreshold = 0.5,
}: {
  line1: string;
  line2: string;
  placeholderChar?: string;
  className?: string;
  line1ClassName?: string;
  line2ClassName?: string;
  startThreshold?: number;
  endThreshold?: number;
}) {
  const fullText = `${line1}\n${line2}`;
  const { containerRef, displayText } = useScrollTextReveal(fullText, placeholderChar, {
    startThreshold,
    endThreshold,
  });

  const [displayLine1, displayLine2] = displayText.split('\n');

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Hidden base text for accessibility */}
      <h1 className="sr-only">
        {line1} {line2}
      </h1>
      {/* Animated visible text */}
      <div className="text-center" aria-hidden="true">
        <span className={line1ClassName}>{displayLine1}</span>
        <br />
        <span className={line2ClassName}>{displayLine2}</span>
      </div>
    </div>
  );
}
