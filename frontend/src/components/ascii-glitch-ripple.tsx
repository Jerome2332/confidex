'use client';

import { useEffect, useRef, useCallback } from 'react';

// Constants for wave animation behavior
const WAVE_THRESH = 3;
const CHAR_MULT = 3;
const ANIM_STEP = 40;
const WAVE_BUF = 5;

interface ASCIIGlitchOptions {
  /** Duration of the wave animation in ms */
  duration?: number;
  /** Characters to use for glitch effect */
  chars?: string;
  /** Whether to preserve spaces during animation */
  preserveSpaces?: boolean;
  /** How fast the wave spreads (lower = faster) */
  spread?: number;
}

interface Wave {
  startPos: number;
  startTime: number;
  id: number;
}

/**
 * Custom hook for ASCII glitch ripple animation on text elements
 */
function useASCIIGlitch<T extends HTMLElement>(options: ASCIIGlitchOptions = {}) {
  const ref = useRef<T>(null);
  const stateRef = useRef<{
    origTxt: string;
    origChars: string[];
    isAnim: boolean;
    cursorPos: number;
    waves: Wave[];
    animId: number | null;
    isHover: boolean;
  }>({
    origTxt: '',
    origChars: [],
    isAnim: false,
    cursorPos: 0,
    waves: [],
    animId: null,
    isHover: false,
  });

  const cfg = {
    duration: 600,
    chars: '.,·-─~+:;=*π""┐┌┘┴┬╗╔╝╚╬╠╣╩╦║░▒▓█▄▀▌▐■!?&#$@0123456789*',
    preserveSpaces: true,
    spread: 0.3,
    ...options,
  };

  const updateCursorPos = useCallback((e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;

    const state = stateRef.current;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const len = state.origTxt.length;
    const pos = Math.round((x / rect.width) * len);
    state.cursorPos = Math.max(0, Math.min(pos, len - 1));
  }, []);

  const cleanupWaves = useCallback((t: number) => {
    const state = stateRef.current;
    state.waves = state.waves.filter((w) => t - w.startTime < cfg.duration);
  }, [cfg.duration]);

  const calcWaveEffect = useCallback((charIdx: number, t: number) => {
    const state = stateRef.current;
    let shouldAnim = false;
    let resultChar = state.origChars[charIdx];

    for (const w of state.waves) {
      const age = t - w.startTime;
      const prog = Math.min(age / cfg.duration, 1);
      const dist = Math.abs(charIdx - w.startPos);
      const maxDist = Math.max(w.startPos, state.origChars.length - w.startPos - 1);
      const rad = (prog * (maxDist + WAVE_BUF)) / cfg.spread;

      if (dist <= rad) {
        shouldAnim = true;
        const intens = Math.max(0, rad - dist);

        if (intens <= WAVE_THRESH && intens > 0) {
          const idx = (dist * CHAR_MULT + Math.floor(age / ANIM_STEP)) % cfg.chars.length;
          resultChar = cfg.chars[idx];
        }
      }
    }

    return { shouldAnim, char: resultChar };
  }, [cfg.duration, cfg.chars, cfg.spread]);

  const genScrambledTxt = useCallback((t: number) => {
    const state = stateRef.current;
    return state.origChars
      .map((char, i) => {
        if (cfg.preserveSpaces && char === ' ') return ' ';
        const res = calcWaveEffect(i, t);
        return res.shouldAnim ? res.char : char;
      })
      .join('');
  }, [cfg.preserveSpaces, calcWaveEffect]);

  const stop = useCallback(() => {
    const el = ref.current;
    const state = stateRef.current;
    if (!el) return;

    el.textContent = state.origTxt;
    el.classList.remove('ascii-glitch-active');
    state.isAnim = false;
  }, []);

  const start = useCallback(() => {
    const el = ref.current;
    const state = stateRef.current;
    if (!el || state.isAnim) return;

    state.isAnim = true;
    el.classList.add('ascii-glitch-active');

    const animate = () => {
      const t = Date.now();
      cleanupWaves(t);

      if (state.waves.length === 0) {
        stop();
        return;
      }

      if (el) {
        el.textContent = genScrambledTxt(t);
      }
      state.animId = requestAnimationFrame(animate);
    };

    state.animId = requestAnimationFrame(animate);
  }, [cleanupWaves, genScrambledTxt, stop]);

  const startWave = useCallback(() => {
    const state = stateRef.current;
    state.waves.push({
      startPos: state.cursorPos,
      startTime: Date.now(),
      id: Math.random(),
    });

    if (!state.isAnim) start();
  }, [start]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const state = stateRef.current;
    state.origTxt = el.textContent || '';
    state.origChars = state.origTxt.split('');

    const handleEnter = (e: MouseEvent) => {
      state.isHover = true;
      updateCursorPos(e);
      startWave();
    };

    const handleMove = (e: MouseEvent) => {
      if (!state.isHover) return;
      const old = state.cursorPos;
      updateCursorPos(e);
      if (state.cursorPos !== old) startWave();
    };

    const handleLeave = () => {
      state.isHover = false;
    };

    el.addEventListener('mouseenter', handleEnter);
    el.addEventListener('mousemove', handleMove);
    el.addEventListener('mouseleave', handleLeave);

    return () => {
      el.removeEventListener('mouseenter', handleEnter);
      el.removeEventListener('mousemove', handleMove);
      el.removeEventListener('mouseleave', handleLeave);

      if (state.animId) {
        cancelAnimationFrame(state.animId);
      }
    };
  }, [updateCursorPos, startWave]);

  return ref;
}

/**
 * ASCII Glitch Ripple Link Component
 * Creates a ripple effect of ASCII characters that follows cursor movement
 */
export function ASCIIGlitchLink({
  href = '#',
  children,
  className = '',
  ariaLabel,
  ...options
}: {
  href?: string;
  children: string;
  className?: string;
  ariaLabel?: string;
} & ASCIIGlitchOptions) {
  const ref = useASCIIGlitch<HTMLAnchorElement>(options);

  return (
    <a
      ref={ref}
      href={href}
      className={`ascii-glitch-link ${className}`}
      aria-label={ariaLabel || children}
    >
      {children}
    </a>
  );
}

/**
 * ASCII Glitch Ripple Text Component
 * Non-interactive version for displaying text with glitch effect
 */
export function ASCIIGlitchText({
  children,
  className = '',
  as: Component = 'span',
  ...options
}: {
  children: string;
  className?: string;
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'div';
} & ASCIIGlitchOptions) {
  const ref = useASCIIGlitch<HTMLElement>(options);

  return (
    <Component
      ref={ref as React.RefObject<never>}
      className={`ascii-glitch-text ${className}`}
    >
      {children}
    </Component>
  );
}

/**
 * ASCII Glitch Demo List
 * Pre-styled list for demonstrating the effect
 */
export function ASCIIGlitchDemo({
  items,
  className = '',
  ...options
}: {
  items: string[];
  className?: string;
} & ASCIIGlitchOptions) {
  return (
    <ul className={`ascii-glitch-list ${className}`}>
      {items.map((item, index) => (
        <li key={index} className="ascii-glitch-item">
          <ASCIIGlitchLink ariaLabel={item} {...options}>
            {item}
          </ASCIIGlitchLink>
        </li>
      ))}
    </ul>
  );
}

export { useASCIIGlitch };
export type { ASCIIGlitchOptions };
