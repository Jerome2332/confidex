'use client';

import { CircleNotch } from '@phosphor-icons/react';

/**
 * Global Loading Component
 *
 * Displayed during page transitions and initial data loading.
 * Uses the Confidex brand styling with accessible loading indicators.
 */
export default function GlobalLoading() {
  return (
    <div
      className="min-h-screen bg-black flex flex-col items-center justify-center"
      role="status"
      aria-label="Loading page"
      aria-live="polite"
    >
      {/* Animated Logo/Spinner */}
      <div className="relative mb-6">
        {/* Outer ring */}
        <div className="w-16 h-16 border-2 border-white/10 rounded-full" />

        {/* Spinning inner ring */}
        <div className="absolute inset-0 flex items-center justify-center">
          <CircleNotch
            size={40}
            className="text-white/60 animate-spin"
            weight="bold"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Loading Text */}
      <p className="text-white/60 font-light text-lg">
        Loading<span className="loading-dots">...</span>
      </p>

      {/* Screen reader text */}
      <span className="sr-only">
        Please wait while the page loads
      </span>

      <style jsx>{`
        @keyframes dots {
          0%, 20% { content: '.'; }
          40% { content: '..'; }
          60%, 100% { content: '...'; }
        }
        .loading-dots::after {
          content: '...';
          animation: dots 1.5s infinite;
        }
      `}</style>
    </div>
  );
}
