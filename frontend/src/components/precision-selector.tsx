'use client';

import { FC, useState, useRef, useEffect } from 'react';
import { CaretDown, Check } from '@phosphor-icons/react';

export type PrecisionOption = '0.01' | '0.1' | '1';

export interface PrecisionSelectorProps {
  value: PrecisionOption;
  onChange: (value: PrecisionOption) => void;
  disabled?: boolean;
}

const PRECISION_OPTIONS: { value: PrecisionOption; label: string }[] = [
  { value: '0.01', label: '0.01' },
  { value: '0.1', label: '0.1' },
  { value: '1', label: '1' },
];

export const PrecisionSelector: FC<PrecisionSelectorProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  const handleSelect = (option: PrecisionOption) => {
    onChange(option);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent, option: PrecisionOption) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect(option);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-1
          px-1.5 py-0.5
          bg-white/5 border border-white/10 rounded
          text-[10px] font-mono text-white/60
          transition-all duration-200
          ${disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:bg-white/10 hover:border-white/20 hover:text-white cursor-pointer'
          }
          ${isOpen ? 'border-white/20 bg-white/10 text-white' : ''}
          focus:outline-none focus:ring-1 focus:ring-white/20
        `}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{value}</span>
        <CaretDown
          size={10}
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
          absolute z-50 right-0 mt-1
          min-w-[60px]
          bg-black border border-white/10 rounded
          shadow-xl shadow-black/50
          overflow-hidden
          transition-all duration-200 origin-top-right
          ${isOpen
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
          }
        `}
        role="listbox"
        aria-label="Select precision"
      >
        <div className="py-0.5">
          {PRECISION_OPTIONS.map((option) => {
            const isSelected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                onKeyDown={(e) => handleKeyDown(e, option.value)}
                className={`
                  w-full flex items-center justify-between gap-2
                  px-2 py-1
                  text-[10px] font-mono text-left
                  transition-colors duration-150
                  ${isSelected
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                  }
                  focus:outline-none focus:bg-white/10
                `}
                role="option"
                aria-selected={isSelected}
              >
                <span>{option.label}</span>
                {isSelected && (
                  <Check size={10} weight="bold" className="text-white/60" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
