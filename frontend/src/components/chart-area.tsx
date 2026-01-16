'use client';

import { FC, useState } from 'react';
import { Maximize2, Minimize2, TrendingUp, TrendingDown } from 'lucide-react';
import { useSolPrice } from '@/hooks/use-pyth-price';

interface TimeframeOption {
  label: string;
  value: string;
}

const TIMEFRAMES: TimeframeOption[] = [
  { label: '1m', value: '1' },
  { label: '5m', value: '5' },
  { label: '15m', value: '15' },
  { label: '1H', value: '60' },
  { label: '4H', value: '240' },
  { label: '1D', value: 'D' },
];

// Pure CSS/HTML chart placeholder - no external scripts, no canvas, no iframes
export const ChartArea: FC = () => {
  const [activeTimeframe, setActiveTimeframe] = useState('15');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { price, isStreaming } = useSolPrice();

  // Use live Pyth price or fallback
  const displayPrice = price ?? 104.52;
  const mockChange = 2.34;
  const isPositive = mockChange >= 0;

  const handleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/50 shrink-0">
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              onClick={() => setActiveTimeframe(tf.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                activeTimeframe === tf.value
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">SOL/USDC</span>
          <button
            onClick={handleFullscreen}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded hover:bg-secondary/50 transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Chart placeholder - CSS-only visualization */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden">
        {/* Background grid pattern */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(to right, currentColor 1px, transparent 1px),
              linear-gradient(to bottom, currentColor 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
          }}
        />

        {/* Mock candlestick visualization using CSS */}
        <div className="relative z-10 flex items-end gap-1 h-32 mb-8">
          {Array.from({ length: 20 }).map((_, i) => {
            const isUp = Math.random() > 0.45;
            const height = 20 + Math.random() * 60;
            const wickHeight = height * 0.3;
            return (
              <div key={i} className="flex flex-col items-center">
                <div
                  className={`w-px ${isUp ? 'bg-white' : 'bg-white/40'}`}
                  style={{ height: wickHeight }}
                />
                <div
                  className={`w-2 rounded-sm ${isUp ? 'bg-white' : 'bg-white/40'}`}
                  style={{ height }}
                />
                <div
                  className={`w-px ${isUp ? 'bg-white' : 'bg-white/40'}`}
                  style={{ height: wickHeight * 0.7 }}
                />
              </div>
            );
          })}
        </div>

        {/* Price display */}
        <div className="relative z-10 text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <span className="text-3xl font-bold font-mono">
              ${displayPrice.toFixed(2)}
            </span>
            <div className={`flex items-center gap-1 ${isPositive ? 'text-white' : 'text-white/60'}`}>
              {isPositive ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              <span className="text-sm font-medium">
                {isPositive ? '+' : ''}{mockChange.toFixed(2)}%
              </span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>{activeTimeframe === 'D' ? 'Daily' : activeTimeframe + ' minute'} timeframe</span>
            {isStreaming && (
              <span className="flex items-center gap-1 text-white">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                Live
              </span>
            )}
          </div>
        </div>

        {/* Chart info */}
        <div className="absolute bottom-4 left-4 right-4 text-center">
          <p className="text-xs text-muted-foreground bg-card/80 rounded-lg py-2 px-4 inline-block">
            Interactive chart coming soon • Live price from Pyth Network
          </p>
        </div>
      </div>
    </div>
  );
};
