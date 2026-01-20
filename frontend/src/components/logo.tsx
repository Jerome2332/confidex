import { FC } from 'react';
import Image from 'next/image';

interface LogoProps {
  /**
   * 'icon' - Just the C logo (for tight spaces)
   * 'wordmark' - Full CONFIDEX wordmark
   * 'auto' - Icon on mobile, wordmark on larger screens
   */
  variant?: 'icon' | 'wordmark' | 'auto';
  /** Height in pixels (width scales proportionally) */
  size?: number;
  className?: string;
}

/**
 * Confidex logo component with responsive variants.
 * Uses the C logo for tight spaces and full wordmark when space permits.
 */
export const Logo: FC<LogoProps> = ({
  variant = 'auto',
  size = 28,
  className = ''
}) => {
  // Wordmark aspect ratio is ~4.5:1 (1850x410)
  const wordmarkWidth = Math.round(size * 4.5);

  if (variant === 'icon') {
    return (
      <Image
        src="/logo-icon.svg"
        alt="Confidex"
        width={size}
        height={size}
        className={className}
        priority
      />
    );
  }

  if (variant === 'wordmark') {
    return (
      <Image
        src="/logo-wordmark.svg"
        alt="Confidex"
        width={wordmarkWidth}
        height={size}
        className={className}
        priority
      />
    );
  }

  // Auto: Show icon on mobile, wordmark on md+ screens
  return (
    <>
      {/* Icon for mobile */}
      <Image
        src="/logo-icon.svg"
        alt="Confidex"
        width={size}
        height={size}
        className={`md:hidden ${className}`}
        priority
      />
      {/* Wordmark for larger screens */}
      <Image
        src="/logo-wordmark.svg"
        alt="Confidex"
        width={wordmarkWidth}
        height={size}
        className={`hidden md:block ${className}`}
        priority
      />
    </>
  );
};

/**
 * Icon-only logo for use in tight spaces like favicons or mobile nav
 */
export const LogoIcon: FC<Omit<LogoProps, 'variant'>> = (props) => (
  <Logo {...props} variant="icon" />
);

/**
 * Full wordmark logo for headers and marketing
 */
export const LogoWordmark: FC<Omit<LogoProps, 'variant'>> = (props) => (
  <Logo {...props} variant="wordmark" />
);
