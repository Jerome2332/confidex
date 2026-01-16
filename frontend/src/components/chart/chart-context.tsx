'use client';

import { createContext, useContext } from 'react';
import { IChartApi } from 'lightweight-charts';

interface ChartContextValue {
  chart: IChartApi | null;
}

export const ChartContext = createContext<ChartContextValue>({ chart: null });

export const useChart = () => {
  const context = useContext(ChartContext);
  if (!context) {
    throw new Error('useChart must be used within a ChartProvider');
  }
  return context;
};
