'use client';

import { useState } from 'react';
import { WalletButton } from '@/components/wallet-button';
import { TradingPanel } from '@/components/trading-panel';
import { BalanceDisplay } from '@/components/balance-display';
import { OrderBook } from '@/components/order-book';
import { OpenOrders } from '@/components/open-orders';
import { TradeHistory } from '@/components/trade-history';
import { MarketTicker } from '@/components/market-ticker';
import { SettingsPanel } from '@/components/settings-panel';
import { Shield, Lock, Zap, ChevronDown, ExternalLink, Github, BookOpen, Settings } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  const [showHero, setShowHero] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold">Confidex</span>
            <span className="text-[10px] text-muted-foreground bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
              DEVNET
            </span>
          </div>
          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-1">
              <Link href="/" className="text-sm font-medium px-3 py-1.5 rounded-lg bg-primary/10 text-primary">
                Trade
              </Link>
              <Link href="/predict" className="text-sm px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
                Predict
              </Link>
              <Link href="/wrap" className="text-sm px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
                Wrap/Unwrap
              </Link>
              <a
                href="https://docs.arcium.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors flex items-center gap-1"
              >
                Docs
                <ExternalLink className="h-3 w-3" />
              </a>
            </nav>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
              title="Settings"
            >
              <Settings className="h-5 w-5" />
            </button>
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {/* Collapsible Hero Section */}
      {showHero && (
        <section className="relative overflow-hidden">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
          <div className="absolute top-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />

          <div className="container mx-auto px-4 py-10 text-center relative">
            <button
              onClick={() => setShowHero(false)}
              className="absolute top-2 right-4 text-muted-foreground hover:text-foreground p-1 hover:bg-secondary/50 rounded transition-colors"
              title="Collapse"
            >
              <ChevronDown className="h-5 w-5" />
            </button>

            {/* Badge */}
            <div className="inline-flex items-center gap-2 text-xs bg-primary/10 text-primary px-3 py-1 rounded-full mb-4 border border-primary/20">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              Solana Privacy Hack 2026
            </div>

            <h1 className="text-3xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground to-primary">
              Trade with Complete Privacy
            </h1>

            <p className="text-muted-foreground max-w-2xl mx-auto mb-8 text-lg">
              The first <span className="text-foreground font-medium">confidential DEX</span> on Solana.
              Your order amounts and prices stay encrypted with Arcium MPC.
              Compliance verified via zero-knowledge proofs.
            </p>

            {/* Feature Pills */}
            <div className="flex flex-wrap justify-center gap-4 mb-8">
              <div className="flex items-center gap-2 text-sm bg-card border border-border px-4 py-2 rounded-lg shadow-sm">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Lock className="h-4 w-4 text-primary" />
                </div>
                <div className="text-left">
                  <div className="font-medium">Encrypted Orders</div>
                  <div className="text-xs text-muted-foreground">Via Arcium MPC</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm bg-card border border-border px-4 py-2 rounded-lg shadow-sm">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Shield className="h-4 w-4 text-primary" />
                </div>
                <div className="text-left">
                  <div className="font-medium">ZK Compliance</div>
                  <div className="text-xs text-muted-foreground">Noir Proofs</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm bg-card border border-border px-4 py-2 rounded-lg shadow-sm">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                <div className="text-left">
                  <div className="font-medium">Private Settlement</div>
                  <div className="text-xs text-muted-foreground">C-SPL Tokens</div>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="flex justify-center gap-8 text-sm">
              <div>
                <div className="text-2xl font-bold font-mono text-primary">$---</div>
                <div className="text-muted-foreground">24h Volume</div>
              </div>
              <div className="border-l border-border" />
              <div>
                <div className="text-2xl font-bold font-mono">---</div>
                <div className="text-muted-foreground">Total Orders</div>
              </div>
              <div className="border-l border-border" />
              <div>
                <div className="text-2xl font-bold font-mono text-green-400">100%</div>
                <div className="text-muted-foreground">Private</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Expand Hero Button */}
      {!showHero && (
        <button
          onClick={() => setShowHero(true)}
          className="w-full py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors flex items-center justify-center gap-1"
        >
          <ChevronDown className="h-3 w-3 rotate-180" />
          Show intro
        </button>
      )}

      {/* Trading Interface */}
      <section className="container mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: Order Book + Trade History */}
          <div className="lg:col-span-3 space-y-4">
            <OrderBook />
            <TradeHistory />
          </div>

          {/* Center: Trading Panel */}
          <div className="lg:col-span-5">
            <TradingPanel />
          </div>

          {/* Right Column: Market + Balance + Open Orders */}
          <div className="lg:col-span-4 space-y-4">
            <MarketTicker />
            <BalanceDisplay />
            <OpenOrders />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-6 mt-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <span>Built for Solana Privacy Hack 2026</span>
              <div className="flex items-center gap-4">
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  <Github className="h-4 w-4" />
                </a>
                <a
                  href="https://docs.arcium.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  <BookOpen className="h-4 w-4" />
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Powered by</span>
              <span className="bg-secondary px-2 py-0.5 rounded">Arcium MPC</span>
              <span className="bg-secondary px-2 py-0.5 rounded">Noir ZK</span>
              <span className="bg-secondary px-2 py-0.5 rounded">ShadowWire</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
