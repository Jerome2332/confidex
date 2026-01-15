'use client';

import { WalletButton } from '@/components/wallet-button';
import { TradingPanel } from '@/components/trading-panel';
import { BalanceDisplay } from '@/components/balance-display';
import { OrderBook } from '@/components/order-book';
import { OpenOrders } from '@/components/open-orders';
import { Shield, Lock, Zap } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">Confidex</span>
            <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">
              DEVNET
            </span>
          </div>
          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-6">
              <a href="/" className="text-sm font-medium text-foreground">
                Trade
              </a>
              <a href="/predict" className="text-sm text-muted-foreground hover:text-foreground">
                Predict
              </a>
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground">
                Wrap/Unwrap
              </a>
              <a href="https://docs.arcium.com" target="_blank" rel="noopener" className="text-sm text-muted-foreground hover:text-foreground">
                Docs
              </a>
            </nav>
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-12 text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Trade with <span className="text-primary">Complete Privacy</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
          The first confidential DEX on Solana. Your order amounts and prices stay encrypted
          using Arcium MPC. Compliance verified via zero-knowledge proofs.
        </p>
        <div className="flex flex-wrap justify-center gap-8 mb-12">
          <div className="flex items-center gap-2 text-sm">
            <Lock className="h-5 w-5 text-primary" />
            <span>Encrypted Orders</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Shield className="h-5 w-5 text-primary" />
            <span>ZK Compliance</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Zap className="h-5 w-5 text-primary" />
            <span>Private Settlement</span>
          </div>
        </div>
      </section>

      {/* Trading Interface */}
      <section className="container mx-auto px-4 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Order Book */}
          <div className="lg:col-span-3">
            <OrderBook />
          </div>

          {/* Center: Trading Panel */}
          <div className="lg:col-span-5">
            <TradingPanel />
          </div>

          {/* Right: Balance & Orders */}
          <div className="lg:col-span-4 space-y-6">
            <BalanceDisplay />
            <OpenOrders />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Built for Solana Privacy Hack 2026</p>
          <p className="mt-2">
            Powered by Arcium MPC + Noir ZK + ShadowWire
          </p>
        </div>
      </footer>
    </main>
  );
}
