'use client';

import { FC, useState, useRef, useEffect } from 'react';
import { CaretDown, Check } from '@phosphor-icons/react';
import Image from 'next/image';

export interface Token {
  symbol: string;
  name: string;
  color?: string;
  icon?: string;
}

export interface TokenSelectorProps {
  value: string;
  onChange: (value: string) => void;
  tokens: Token[];
  disabled?: boolean;
}

// Token icon paths
const TOKEN_ICONS: Record<string, string> = {
  SOL: '/coin-icons/SOL-logo.png',
  USDC: '/coin-icons/USDC-logo.png',
};

// Default token colors following brand guidelines (used as fallback)
const getTokenColor = (symbol: string, customColor?: string): string => {
  if (customColor) return customColor;

  const colors: Record<string, string> = {
    SOL: '#9945FF',
    USDC: '#2775CA',
    USDT: '#26A17B',
    ETH: '#627EEA',
    BTC: '#F7931A',
  };

  return colors[symbol] || '#ffffff';
};

// Token icon component with fallback to colored circle
const TokenIcon: FC<{ symbol: string; color?: string; size?: number }> = ({
  symbol,
  color,
  size = 20,
}) => {
  const [hasError, setHasError] = useState(false);
  const iconPath = TOKEN_ICONS[symbol];

  if (iconPath && !hasError) {
    return (
      <div
        className="rounded-full overflow-hidden ring-1 ring-white/10 flex-shrink-0"
        style={{ width: size, height: size }}
      >
        <Image
          src={iconPath}
          alt={`${symbol} icon`}
          width={size}
          height={size}
          className="object-cover"
          onError={() => setHasError(true)}
        />
      </div>
    );
  }

  // Fallback to colored circle with initial
  return (
    <div
      className="rounded-full flex items-center justify-center ring-1 ring-white/10 flex-shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: getTokenColor(symbol, color),
      }}
    >
      <span
        className="font-medium text-white/90"
        style={{ fontSize: size * 0.45 }}
      >
        {symbol.charAt(0)}
      </span>
    </div>
  );
};

export const TokenSelector: FC<TokenSelectorProps> = ({
  value,
  onChange,
  tokens,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selectedToken = tokens.find((t) => t.symbol === value) || tokens[0];

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleSelect = (token: Token) => {
    onChange(token.symbol);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent, token: Token) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect(token);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          w-full flex items-center justify-between gap-3
          px-3 py-2
          bg-white/5 border border-white/10 rounded-lg
          text-sm font-light text-white
          transition-all duration-200
          ${disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:bg-white/10 hover:border-white/20 cursor-pointer'
          }
          ${isOpen ? 'border-white/20 bg-white/10' : ''}
          focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20
        `}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2.5">
          {/* Token Avatar */}
          <TokenIcon symbol={selectedToken.symbol} color={selectedToken.color} size={20} />

          {/* Token Info */}
          <div className="flex items-center gap-2">
            <span className="font-normal">{selectedToken.symbol}</span>
            <span className="text-white/40 text-xs hidden sm:inline">
              {selectedToken.name}
            </span>
          </div>
        </div>

        {/* Caret */}
        <CaretDown
          size={14}
          weight="bold"
          className={`
            text-white/40 transition-transform duration-200
            ${isOpen ? 'rotate-180' : ''}
          `}
        />
      </button>

      {/* Dropdown Panel */}
      <div
        className={`
          absolute z-50 w-full mt-1
          bg-black border border-white/10 rounded-lg
          shadow-xl shadow-black/50
          overflow-hidden
          transition-all duration-200 origin-top
          ${isOpen
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
          }
        `}
        role="listbox"
        aria-label="Select token"
      >
        <div className="py-1">
          {tokens.map((token) => {
            const isSelected = token.symbol === value;

            return (
              <button
                key={token.symbol}
                type="button"
                onClick={() => handleSelect(token)}
                onKeyDown={(e) => handleKeyDown(e, token)}
                className={`
                  w-full flex items-center justify-between gap-3
                  px-3 py-2
                  text-sm font-light text-left
                  transition-colors duration-150
                  ${isSelected
                    ? 'bg-white/10 text-white'
                    : 'text-white/80 hover:bg-white/5 hover:text-white'
                  }
                  focus:outline-none focus:bg-white/10
                `}
                role="option"
                aria-selected={isSelected}
              >
                <div className="flex items-center gap-2.5">
                  {/* Token Avatar */}
                  <TokenIcon symbol={token.symbol} color={token.color} size={20} />

                  {/* Token Info */}
                  <div className="flex items-center gap-2">
                    <span className={isSelected ? 'font-normal' : ''}>
                      {token.symbol}
                    </span>
                    <span className="text-white/40 text-xs">
                      {token.name}
                    </span>
                  </div>
                </div>

                {/* Check mark for selected */}
                {isSelected && (
                  <Check size={14} weight="bold" className="text-white/60" />
                )}
              </button>
            );
          })}
        </div>

        {/* Subtle bottom accent line */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>
    </div>
  );
};

// Pre-configured tokens list for easy import
export const AVAILABLE_TOKENS: Token[] = [
  { symbol: 'SOL', name: 'Solana' },
  // Future tokens can be added here:
  // { symbol: 'USDC', name: 'USD Coin' },
  // { symbol: 'ETH', name: 'Ethereum' },
];

// Export TokenIcon for use in other components
export { TokenIcon, TOKEN_ICONS };
