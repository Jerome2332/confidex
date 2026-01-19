'use client';

import { FC, useState, useCallback } from 'react';
import { Warning } from '@phosphor-icons/react';

const LEVERAGE_PRESETS = [1, 2, 5, 10, 20];

interface LeverageSelectorProps {
  value: number;
  onChange: (value: number) => void;
  maxLeverage?: number;
  minLeverage?: number;
  showWarning?: boolean;
  disabled?: boolean;
  variant?: 'default' | 'compact';
}

export const LeverageSelector: FC<LeverageSelectorProps> = ({
  value,
  onChange,
  maxLeverage = 20,
  minLeverage = 1,
  showWarning = true,
  disabled = false,
  variant = 'default',
}) => {
  const [inputValue, setInputValue] = useState(value.toString());
  const [isFocused, setIsFocused] = useState(false);

  const handleSliderChange = useCallback((newValue: number) => {
    const clamped = Math.min(maxLeverage, Math.max(minLeverage, newValue));
    onChange(clamped);
    setInputValue(clamped.toString());
  }, [maxLeverage, minLeverage, onChange]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);

    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed >= minLeverage && parsed <= maxLeverage) {
      onChange(parsed);
    }
  }, [maxLeverage, minLeverage, onChange]);

  const handleInputBlur = useCallback(() => {
    setIsFocused(false);
    const parsed = parseFloat(inputValue);
    if (isNaN(parsed) || parsed < minLeverage) {
      setInputValue(minLeverage.toString());
      onChange(minLeverage);
    } else if (parsed > maxLeverage) {
      setInputValue(maxLeverage.toString());
      onChange(maxLeverage);
    } else {
      // Round to 1 decimal place
      const rounded = Math.round(parsed * 10) / 10;
      setInputValue(rounded.toString());
      onChange(rounded);
    }
  }, [inputValue, maxLeverage, minLeverage, onChange]);

  const handlePresetClick = useCallback((preset: number) => {
    if (preset <= maxLeverage && preset >= minLeverage) {
      onChange(preset);
      setInputValue(preset.toString());
    }
  }, [maxLeverage, minLeverage, onChange]);

  const isHighLeverage = value >= 10;
  const isVeryHighLeverage = value >= 15;

  if (variant === 'compact') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Leverage</span>
          <div className="flex-1 flex items-center gap-1">
            {LEVERAGE_PRESETS.filter(p => p <= maxLeverage).map(preset => (
              <button
                key={preset}
                onClick={() => handlePresetClick(preset)}
                disabled={disabled}
                className={`flex-1 text-xs py-1 rounded border transition-colors ${
                  value === preset
                    ? 'bg-primary/20 border-primary text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/50'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {preset}x
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">Leverage</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={isFocused ? inputValue : value}
            onChange={handleInputChange}
            onFocus={() => setIsFocused(true)}
            onBlur={handleInputBlur}
            min={minLeverage}
            max={maxLeverage}
            step="0.1"
            disabled={disabled}
            className={`w-16 bg-secondary border rounded px-2 py-1 text-sm text-right font-mono ${
              isVeryHighLeverage
                ? 'border-rose-500/30 text-rose-400/80'
                : isHighLeverage
                ? 'border-white/30 text-white/80'
                : 'border-border'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          />
          <span className="text-xs text-muted-foreground">x</span>
        </div>
      </div>

      {/* Slider */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-6">{minLeverage}x</span>
        <input
          type="range"
          min={minLeverage}
          max={maxLeverage}
          step="1"
          value={value}
          onChange={(e) => handleSliderChange(parseInt(e.target.value))}
          disabled={disabled}
          className={`flex-1 h-1 cursor-pointer appearance-none bg-secondary rounded-full ${
            isVeryHighLeverage
              ? '[&::-webkit-slider-thumb]:bg-rose-400/80'
              : isHighLeverage
              ? '[&::-webkit-slider-thumb]:bg-white/80'
              : '[&::-webkit-slider-thumb]:bg-primary'
          } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full disabled:opacity-50 disabled:cursor-not-allowed`}
        />
        <span className="text-xs text-muted-foreground w-6 text-right">{maxLeverage}x</span>
      </div>

      {/* Presets */}
      <div className="flex gap-1">
        {LEVERAGE_PRESETS.filter(p => p <= maxLeverage).map(preset => (
          <button
            key={preset}
            onClick={() => handlePresetClick(preset)}
            disabled={disabled}
            className={`flex-1 text-xs py-1.5 rounded border transition-colors ${
              value === preset
                ? preset >= 15
                  ? 'bg-rose-500/20 border-rose-500/30 text-rose-400/80'
                  : preset >= 10
                  ? 'bg-white/10 border-white/30 text-white/80'
                  : 'bg-primary/20 border-primary text-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/50'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {preset}x
          </button>
        ))}
      </div>

      {/* Warning for high leverage */}
      {showWarning && isHighLeverage && (
        <div className={`p-2 rounded text-xs flex items-start gap-2 ${
          isVeryHighLeverage
            ? 'bg-rose-500/20 border border-rose-500/30 text-rose-400/80'
            : 'bg-white/10 border border-white/30 text-white/80'
        }`}>
          <Warning size={12} className="mt-0.5 shrink-0" />
          <span>
            {isVeryHighLeverage
              ? 'Extreme leverage. Position can be liquidated with small price movements.'
              : 'High leverage increases liquidation risk. Trade carefully.'}
          </span>
        </div>
      )}
    </div>
  );
};
