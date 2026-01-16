'use client';

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import {
  HistogramSeries,
  HistogramData,
  Time,
  ISeriesApi,
} from 'lightweight-charts';
import { useChart } from './chart-context';

export interface VolumeData {
  time: Time;
  value: number;
  color?: string;
}

export interface VolumeSeriesProps {
  data: VolumeData[];
  /** Colors for up/down volume bars */
  upColor?: string;
  downColor?: string;
  /** Position in chart (0-1 range for top margin) */
  topMargin?: number;
  /** Called when series is created */
  onSeriesReady?: (series: ISeriesApi<'Histogram'>) => void;
}

export interface VolumeSeriesRef {
  series: ISeriesApi<'Histogram'> | null;
  update: (bar: HistogramData<Time>) => void;
  setData: (data: HistogramData<Time>[]) => void;
}

export const VolumeSeries = forwardRef<VolumeSeriesRef, VolumeSeriesProps>(
  (
    {
      data,
      upColor = '#22c55e40',
      downColor = '#ef444440',
      topMargin = 0.85,
      onSeriesReady,
    },
    ref
  ) => {
    const { chart } = useChart();
    const seriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

    // Expose series methods to parent
    useImperativeHandle(ref, () => ({
      series: seriesRef.current,
      update: (bar: HistogramData<Time>) => seriesRef.current?.update(bar),
      setData: (newData: HistogramData<Time>[]) => seriesRef.current?.setData(newData),
    }));

    // Create series when chart is available
    useEffect(() => {
      if (!chart) return;

      const series = chart.addSeries(HistogramSeries, {
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume',
      });

      // Configure volume price scale
      chart.priceScale('volume').applyOptions({
        scaleMargins: {
          top: topMargin,
          bottom: 0,
        },
        borderVisible: false,
      });

      seriesRef.current = series;
      onSeriesReady?.(series);

      // Set initial data
      if (data.length > 0) {
        series.setData(data);
      }

      return () => {
        if (chart) {
          try {
            chart.removeSeries(series);
          } catch {
            // Chart may already be disposed
          }
        }
        seriesRef.current = null;
      };
    }, [chart, topMargin, onSeriesReady]);

    // Update data when it changes
    useEffect(() => {
      if (seriesRef.current && data.length > 0) {
        seriesRef.current.setData(data);
      }
    }, [data]);

    return null;
  }
);

VolumeSeries.displayName = 'VolumeSeries';
