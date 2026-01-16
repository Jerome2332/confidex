'use client';

import { FC, useState, useEffect, useRef, memo } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

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

// TradingView Widget Component
const TradingViewWidget: FC<{ interval: string }> = memo(({ interval }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous widget
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: 'PYTH:SOLUSD',
      interval: interval,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(0, 0, 0, 1)',
      gridColor: 'rgba(255, 255, 255, 0.06)',
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: 'https://www.tradingview.com',
      // Monochrome color overrides
      overrides: {
        'paneProperties.background': '#000000',
        'paneProperties.backgroundType': 'solid',
        'paneProperties.vertGridProperties.color': 'rgba(255, 255, 255, 0.06)',
        'paneProperties.horzGridProperties.color': 'rgba(255, 255, 255, 0.06)',
        'scalesProperties.textColor': 'rgba(255, 255, 255, 0.6)',
        'scalesProperties.lineColor': 'rgba(255, 255, 255, 0.1)',
        'mainSeriesProperties.candleStyle.upColor': '#ffffff',
        'mainSeriesProperties.candleStyle.downColor': 'rgba(255, 255, 255, 0.4)',
        'mainSeriesProperties.candleStyle.borderUpColor': '#ffffff',
        'mainSeriesProperties.candleStyle.borderDownColor': 'rgba(255, 255, 255, 0.4)',
        'mainSeriesProperties.candleStyle.wickUpColor': '#ffffff',
        'mainSeriesProperties.candleStyle.wickDownColor': 'rgba(255, 255, 255, 0.4)',
      },
    });

    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [interval]);

  return (
    <div className="tradingview-widget-container h-full w-full" ref={containerRef}>
      <div className="tradingview-widget-container__widget h-full w-full" />
    </div>
  );
});

TradingViewWidget.displayName = 'TradingViewWidget';

export const ChartArea: FC = () => {
  const [activeTimeframe, setActiveTimeframe] = useState('15');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const handleFullscreen = () => {
    if (!chartContainerRef.current) return;

    if (!isFullscreen) {
      if (chartContainerRef.current.requestFullscreen) {
        chartContainerRef.current.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return (
    <div ref={chartContainerRef} className="h-full flex flex-col bg-black">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-black shrink-0">
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              onClick={() => setActiveTimeframe(tf.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                activeTimeframe === tf.value
                  ? 'bg-white/10 text-white'
                  : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">SOL/USD</span>
          <button
            onClick={handleFullscreen}
            className="p-1.5 text-white/50 hover:text-white rounded hover:bg-white/5 transition-colors"
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

      {/* TradingView Chart */}
      <div className="flex-1 min-h-0">
        <TradingViewWidget interval={activeTimeframe} />
      </div>
    </div>
  );
};
