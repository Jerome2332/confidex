'use client';

import {
  FC,
  ReactNode,
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { createChart, IChartApi, CrosshairMode } from 'lightweight-charts';
import { ChartContext } from './chart-context';

// Configuration constants
const RESIZE_DEBOUNCE_MS = 50;

export interface ChartContainerProps {
  children?: ReactNode;
  className?: string;
  /** Called when chart is ready */
  onChartReady?: (chart: IChartApi) => void;
  /** Called on crosshair move with price data */
  onCrosshairMove?: (params: CrosshairMoveParams | null) => void;
}

export interface CrosshairMoveParams {
  time: number;
  price?: number;
}

export interface ChartContainerRef {
  chart: IChartApi | null;
  fitContent: () => void;
}

export const ChartContainer = forwardRef<ChartContainerRef, ChartContainerProps>(
  ({ children, className, onChartReady, onCrosshairMove }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [chart, setChart] = useState<IChartApi | null>(null);

    // Expose chart methods to parent
    useImperativeHandle(ref, () => ({
      chart: chartRef.current,
      fitContent: () => chartRef.current?.timeScale().fitContent(),
    }));

    // Throttled resize handler
    const handleResize = useCallback((width: number, height: number) => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(() => {
        if (chartRef.current && width > 0 && height > 0) {
          chartRef.current.applyOptions({ width, height });
        }
      }, RESIZE_DEBOUNCE_MS);
    }, []);

    // Initialize chart
    useEffect(() => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const { clientWidth, clientHeight } = container;

      const newChart = createChart(container, {
        width: clientWidth || 400,
        height: clientHeight || 300,
        layout: {
          background: { color: 'transparent' },
          textColor: '#9ca3af',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
        grid: {
          vertLines: { color: '#1f293720' },
          horzLines: { color: '#1f293720' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: '#6b7280',
            width: 1,
            style: 2,
            labelBackgroundColor: '#374151',
          },
          horzLine: {
            color: '#6b7280',
            width: 1,
            style: 2,
            labelBackgroundColor: '#374151',
          },
        },
        rightPriceScale: {
          borderColor: '#374151',
          scaleMargins: {
            top: 0.1,
            bottom: 0.2,
          },
        },
        timeScale: {
          borderColor: '#374151',
          timeVisible: true,
          secondsVisible: false,
          enableConflation: true,
        },
        handleScale: {
          axisPressedMouseMove: true,
        },
        handleScroll: {
          vertTouchDrag: false,
        },
      });

      chartRef.current = newChart;
      setChart(newChart);

      // Notify parent that chart is ready
      onChartReady?.(newChart);

      // Subscribe to crosshair move
      if (onCrosshairMove) {
        newChart.subscribeCrosshairMove(param => {
          if (!param.time) {
            onCrosshairMove(null);
            return;
          }
          onCrosshairMove({
            time: param.time as number,
            price: param.point?.y,
          });
        });
      }

      // Handle resize with throttling
      const resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        if (entry) {
          const { width, height } = entry.contentRect;
          handleResize(width, height);
        }
      });
      resizeObserver.observe(container);

      return () => {
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }
        resizeObserver.disconnect();
        newChart.remove();
        chartRef.current = null;
        setChart(null);
      };
    }, [handleResize, onChartReady, onCrosshairMove]);

    return (
      <ChartContext.Provider value={{ chart }}>
        <div ref={containerRef} className={className}>
          {chart && children}
        </div>
      </ChartContext.Provider>
    );
  }
);

ChartContainer.displayName = 'ChartContainer';
