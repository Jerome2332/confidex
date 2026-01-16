'use client';

import { useState } from 'react';
import { Shield, Settings } from 'lucide-react';
import Link from 'next/link';
import { WalletButton } from '@/components/wallet-button';
import { MarketTicker } from '@/components/market-ticker';
import { OrderBook } from '@/components/order-book';
import { TradingPanel } from '@/components/trading-panel';
import { ChartArea } from '@/components/chart-area';
import { BottomTabs } from '@/components/bottom-tabs';
import { SettingsPanel } from '@/components/settings-panel';

// Full trade page with all components
export default function TradePage() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <main className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold">Confidex</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            <Link href="/trade" className="text-sm font-medium text-primary">
              Trade
            </Link>
            <Link href="/wrap" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Wrap
            </Link>
            <Link href="/predict" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Predict
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-muted-foreground hover:text-foreground transition-colors"
              title="Settings"
            >
              <Settings className="h-5 w-5" />
            </button>
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Market Ticker */}
      <MarketTicker variant="bar" />

      {/* Main Content - Hyperliquid-style layout */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: Order Book */}
        <div className="w-64 border-r border-border overflow-y-auto hidden lg:block">
          <OrderBook variant="compact" />
        </div>

        {/* Center: Chart + Bottom Tabs */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chart */}
          <div className="flex-1 min-h-0">
            <ChartArea />
          </div>

          {/* Bottom Tabs: Open Orders, Trade History */}
          <BottomTabs defaultHeight={200} />
        </div>

        {/* Right: Trading Panel (includes account section) */}
        <div className="w-80 border-l border-border overflow-y-auto hidden md:flex">
          <TradingPanel />
        </div>
      </div>

      {/* Settings Panel Modal */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </main>
  );
}
