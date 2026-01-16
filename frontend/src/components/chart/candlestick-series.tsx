'use client';

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import {
  CandlestickSeries as LWCandlestickSeries,
  CandlestickData,
  Time,
  ISeriesApi,
} from 'lightweight-charts';
import { useChart } from './chart-context';

export interface CandlestickSeriesProps {
  data: CandlestickData<Time>[];
  /** Colors for up/down candles */
  upColor?: string;
  downColor?: string;
  /** Called when series is created */
  onSeriesReady?: (series: ISeriesApi<'Candlestick'>) => void;
}

export interface CandlestickSeriesRef {
  series: ISeriesApi<'Candlestick'> | null;
  update: (bar: CandlestickData<Time>) => void;
  setData: (data: CandlestickData<Time>[]) => void;
}

export const CandlestickSeries = forwardRef<CandlestickSeriesRef, CandlestickSeriesProps>(
  (
    {
      data,
      upColor = '#22c55e',
      downColor = '#ef4444',
      onSeriesReady,
    },
    ref
  ) => {
    const { chart } = useChart();
    const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

    // Expose series methods to parent
    useImperativeHandle(ref, () => ({
      series: seriesRef.current,
      update: (bar: CandlestickData<Time>) => seriesRef.current?.update(bar),
      setData: (newData: CandlestickData<Time>[]) => seriesRef.current?.setData(newData),
    }));

    // Create series when chart is available
    useEffect(() => {
      if (!chart) return;

      const series = chart.addSeries(LWCandlestickSeries, {
        upColor,
        downColor,
        borderUpColor: upColor,
        borderDownColor: downColor,
        wickUpColor: upColor,
        wickDownColor: downColor,
        priceScaleId: 'right',
      });

      seriesRef.current = series;
      onSeriesReady?.(series);

      // Set initial data
      if (data.length > 0) {
        series.setData(data);
      }

      return () => {
        // Note: Series is automatically removed when chart is removed
        // Only explicitly remove if chart still exists
        if (chart) {
          try {
            chart.removeSeries(series);
          } catch {
            // Chart may already be disposed
          }
        }
        seriesRef.current = null;
      };
    }, [chart, upColor, downColor, onSeriesReady]);

    // Update data when it changes
    useEffect(() => {
      if (seriesRef.current && data.length > 0) {
        seriesRef.current.setData(data);
      }
    }, [data]);

    return null; // This component doesn't render anything
  }
);

CandlestickSeries.displayName = 'CandlestickSeries';
