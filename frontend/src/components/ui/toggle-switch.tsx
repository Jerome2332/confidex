'use client';

import { FC } from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

export const ToggleSwitch: FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  size = 'md',
  disabled = false,
}) => {
  const sizes = {
    sm: {
      track: 'w-7 h-3.5',
      thumb: 'w-2.5 h-2.5',
      translate: checked ? 'translate-x-3.5' : 'translate-x-0.5',
    },
    md: {
      track: 'w-10 h-5',
      thumb: 'w-4 h-4',
      translate: checked ? 'translate-x-5' : 'translate-x-0.5',
    },
  };

  const s = sizes[size];

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`${s.track} rounded-full transition-colors relative ${
        checked ? 'bg-white' : 'bg-white/20'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div
        className={`${s.thumb} bg-black rounded-full absolute top-1/2 -translate-y-1/2 transition-transform ${s.translate}`}
      />
    </button>
  );
};
