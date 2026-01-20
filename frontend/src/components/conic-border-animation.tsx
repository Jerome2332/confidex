'use client';

import { CSSProperties, useEffect, useId, useState } from 'react';

interface ConicBorderProps {
  /** Width of the container in pixels (undefined for fluid width) */
  width?: number;
  /** Height of the container in pixels (undefined for fluid height) */
  height?: number;
  /** Border radius in pixels */
  borderRadius?: number;
  /** Border width in pixels */
  borderWidth?: number;
  /** Animation duration in seconds */
  duration?: number;
  /** Content to render inside the border */
  children?: React.ReactNode;
  /** Additional class names */
  className?: string;
}

/**
 * ConicBorderAnimation
 *
 * A rotating conic gradient border effect using CSS animation.
 * Uses a rotating pseudo-element technique for maximum browser compatibility.
 */
export function ConicBorderAnimation({
  width,
  height,
  borderRadius = 32,
  borderWidth = 2,
  duration = 4,
  children,
  className = '',
}: ConicBorderProps) {
  const innerRadius = Math.max(0, borderRadius - borderWidth);
  const uniqueId = useId().replace(/:/g, '');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // CSS for the animation - injected once per component instance
  const animationStyles = `
    @keyframes conic-rotate-${uniqueId} {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }

    .conic-wrapper-${uniqueId} {
      position: relative;
    }

    .conic-border-${uniqueId} {
      position: absolute;
      inset: 0;
      border-radius: ${borderRadius}px;
      overflow: hidden;
    }

    .conic-border-${uniqueId}::before {
      content: '';
      position: absolute;
      inset: -50%;
      background: conic-gradient(
        from 0deg,
        rgba(255, 255, 255, 0.1) 0deg,
        rgba(255, 255, 255, 0.1) 60deg,
        rgba(255, 255, 255, 0.9) 120deg,
        rgba(255, 255, 255, 0.1) 180deg,
        rgba(255, 255, 255, 0.1) 240deg,
        rgba(255, 255, 255, 0.9) 300deg,
        rgba(255, 255, 255, 0.1) 360deg
      );
      animation: conic-rotate-${uniqueId} ${duration}s linear infinite;
    }
  `;

  return (
    <>
      {mounted && (
        <style dangerouslySetInnerHTML={{ __html: animationStyles }} />
      )}
      <div
        className={`conic-wrapper-${uniqueId} ${className}`}
        style={{
          width: width !== undefined ? `${width}px` : undefined,
          height: height !== undefined ? `${height}px` : undefined,
          padding: `${borderWidth}px`,
          borderRadius: `${borderRadius}px`,
        } as CSSProperties}
      >
        {/* Animated border layer */}
        <div className={`conic-border-${uniqueId}`} />
        {/* Content layer */}
        <div
          className="relative bg-black w-full h-full"
          style={{
            borderRadius: `${innerRadius}px`,
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}

interface ConicBorderCardProps {
  /** Title text */
  title?: string;
  /** Description text */
  description?: string;
  /** Width of the card */
  width?: number;
  /** Height of the card */
  height?: number;
  /** Animation duration */
  duration?: number;
}

/**
 * ConicBorderCard
 *
 * A pre-styled card component with the conic border animation.
 */
export function ConicBorderCard({
  title = 'Confidex',
  description = 'Private. Secure. Fast.',
  width = 352,
  height = 200,
  duration = 4,
}: ConicBorderCardProps) {
  return (
    <ConicBorderAnimation
      width={width}
      height={height}
      borderRadius={24}
      borderWidth={2}
      duration={duration}
    >
      <div className="w-full h-full flex items-center justify-center text-center p-8">
        <div>
          <h3 className="text-2xl font-light text-white mb-2">{title}</h3>
          <p className="text-white/60 text-sm">{description}</p>
        </div>
      </div>
    </ConicBorderAnimation>
  );
}

/**
 * CheckeredBackground
 *
 * The subtle checkered background pattern from the original demo.
 */
export function CheckeredBackground({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen w-full grid place-items-center"
      style={{
        background: `#000 conic-gradient(
          #fff1 0.25turn,
          #0005 0.25turn 0.5turn,
          #fff1 0.5turn 0.75turn,
          #0005 0.75turn
        ) top left / 2vmax 2vmax repeat`,
      }}
    >
      {children}
    </div>
  );
}
