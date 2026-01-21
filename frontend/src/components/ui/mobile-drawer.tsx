'use client';

import { FC, ReactNode, useEffect, useState, useCallback } from 'react';
import { X } from '@phosphor-icons/react';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /**
   * Height of the drawer when open
   * @default '85vh'
   */
  height?: string;
}

/**
 * Mobile Bottom Sheet Drawer Component
 *
 * A sliding drawer that appears from the bottom on mobile devices.
 * Includes touch gestures for closing and backdrop click to dismiss.
 */
export const MobileDrawer: FC<MobileDrawerProps> = ({
  isOpen,
  onClose,
  children,
  title,
  height = '85vh',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [startY, setStartY] = useState(0);

  // Handle visibility animation
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Touch handlers for swipe to close
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true);
    setStartY(e.touches[0].clientY);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY;
    // Only allow dragging down
    if (diff > 0) {
      setDragOffset(diff);
    }
  }, [isDragging, startY]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    // Close if dragged more than 100px
    if (dragOffset > 100) {
      onClose();
    }
    setDragOffset(0);
  }, [dragOffset, onClose]);

  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-50 md:hidden"
      aria-modal="true"
      role="dialog"
      aria-label={title || 'Bottom drawer'}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-card border-t border-border rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          height,
          transform: isOpen
            ? `translateY(${dragOffset}px)`
            : 'translateY(100%)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag Handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div
            className="w-10 h-1 rounded-full bg-white/20"
            aria-hidden="true"
          />
        </div>

        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <h2 className="text-sm font-medium text-foreground">{title}</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
              aria-label="Close drawer"
            >
              <X size={20} />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="overflow-y-auto h-full pb-safe">
          {children}
        </div>
      </div>
    </div>
  );
};

/**
 * Floating Action Button for opening the drawer
 */
interface MobileFABProps {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  variant?: 'buy' | 'sell' | 'neutral';
}

export const MobileFAB: FC<MobileFABProps> = ({
  onClick,
  icon,
  label,
  variant = 'neutral',
}) => {
  const variantStyles = {
    buy: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30',
    sell: 'bg-rose-500/20 border-rose-500/30 text-rose-400 hover:bg-rose-500/30',
    neutral: 'bg-white/10 border-white/20 text-white hover:bg-white/20',
  };

  return (
    <button
      onClick={onClick}
      className={`fixed bottom-4 right-4 z-40 md:hidden flex items-center gap-2 px-4 py-3 rounded-full border shadow-lg transition-colors ${variantStyles[variant]}`}
      aria-label={label}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
};
