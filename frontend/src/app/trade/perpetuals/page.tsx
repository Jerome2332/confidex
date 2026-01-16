'use client';

import { Header } from '@/components/header';
import { OrderBook } from '@/components/order-book';
import { TradingPanel } from '@/components/trading-panel';
import { ChartArea } from '@/components/chart-area';
import { BottomTabs } from '@/components/bottom-tabs';

export default function PerpetualsPage() {
  return (
    <main className="h-screen flex flex-col bg-background">
      {/* Header with Market Ticker */}
      <Header showMarketTicker />

      {/* Main Content - Trading terminal layout */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: Chart + Order Book + Bottom Tabs */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top: Chart + Order Book */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Chart */}
            <div className="flex-1 min-w-0">
              <ChartArea />
            </div>

            {/* Order Book */}
            <div className="w-64 border-l border-border overflow-y-auto hidden lg:block">
              <OrderBook variant="compact" />
            </div>
          </div>

          {/* Bottom: Tabs spanning under chart + order book */}
          <BottomTabs defaultHeight={200} />
        </div>

        {/* Right: Trading Panel (full height) */}
        <div className="w-80 border-l border-border overflow-y-auto hidden md:block">
          <TradingPanel mode="perps" />
        </div>
      </div>
    </main>
  );
}
