'use client';

import { FC, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Lock, Loader2, Shield, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useOrderStore } from '@/stores/order-store';

type OrderSide = 'buy' | 'sell';
type OrderType = 'limit' | 'market';

export const TradingPanel: FC = () => {
  const { connected, publicKey } = useWallet();
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [proofStatus, setProofStatus] = useState<'idle' | 'generating' | 'ready'>('idle');

  const handleSubmit = async () => {
    if (!connected || !publicKey) {
      toast.error('Please connect your wallet');
      return;
    }

    if (!amount || (orderType === 'limit' && !price)) {
      toast.error('Please fill in all fields');
      return;
    }

    setIsSubmitting(true);
    setProofStatus('generating');

    try {
      // Simulate proof generation (2-3 seconds)
      toast.info('Generating eligibility proof...');
      await new Promise((r) => setTimeout(r, 2500));
      setProofStatus('ready');

      // Simulate order encryption and submission
      toast.info('Encrypting order parameters...');
      await new Promise((r) => setTimeout(r, 1000));

      toast.success(
        `${side.toUpperCase()} order placed successfully`,
        {
          description: `${amount} SOL @ ${price || 'market'} USDC (encrypted)`,
        }
      );

      // Reset form
      setAmount('');
      setPrice('');
      setProofStatus('idle');
    } catch (error) {
      toast.error('Failed to place order');
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Place Order</h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          <span>Encrypted</span>
        </div>
      </div>

      {/* Pair Selector */}
      <div className="mb-6">
        <label className="text-sm text-muted-foreground mb-2 block">
          Trading Pair
        </label>
        <select className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground">
          <option value="SOL/USDC">SOL / USDC</option>
          <option value="BONK/USDC" disabled>BONK / USDC (coming soon)</option>
        </select>
      </div>

      {/* Side Tabs */}
      <div className="flex mb-6">
        <button
          onClick={() => setSide('buy')}
          className={`flex-1 py-3 text-center font-medium rounded-l-lg transition-colors ${
            side === 'buy'
              ? 'bg-green-500/20 text-green-400 border border-green-500/50'
              : 'bg-secondary text-muted-foreground border border-border'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`flex-1 py-3 text-center font-medium rounded-r-lg transition-colors ${
            side === 'sell'
              ? 'bg-red-500/20 text-red-400 border border-red-500/50'
              : 'bg-secondary text-muted-foreground border border-border'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Order Type */}
      <div className="flex gap-4 mb-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="orderType"
            checked={orderType === 'limit'}
            onChange={() => setOrderType('limit')}
            className="text-primary"
          />
          <span className="text-sm">Limit</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="orderType"
            checked={orderType === 'market'}
            onChange={() => setOrderType('market')}
            className="text-primary"
          />
          <span className="text-sm">Market</span>
        </label>
      </div>

      {/* Amount Input */}
      <div className="mb-4">
        <label className="text-sm text-muted-foreground mb-2 block">
          Amount (SOL)
        </label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground"
          />
          <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Price Input (Limit only) */}
      {orderType === 'limit' && (
        <div className="mb-6">
          <label className="text-sm text-muted-foreground mb-2 block">
            Price (USDC)
          </label>
          <div className="relative">
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground"
            />
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Proof Status */}
      {proofStatus !== 'idle' && (
        <div className="mb-4 p-3 bg-secondary rounded-lg">
          <div className="flex items-center gap-2">
            {proofStatus === 'generating' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm">Generating ZK proof...</span>
              </>
            ) : (
              <>
                <Shield className="h-4 w-4 text-primary" />
                <span className="text-sm text-primary">Proof ready</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={!connected || isSubmitting}
        className={`w-full py-4 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 ${
          side === 'buy'
            ? 'bg-green-500 hover:bg-green-600 text-white'
            : 'bg-red-500 hover:bg-red-600 text-white'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Processing...
          </>
        ) : !connected ? (
          'Connect Wallet'
        ) : (
          `${side === 'buy' ? 'Buy' : 'Sell'} SOL`
        )}
      </button>

      {/* Privacy Notice */}
      <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <p>
          Your order amount and price are encrypted using Arcium MPC.
          Only matching orders can reveal if prices cross.
        </p>
      </div>
    </div>
  );
};
