'use client';

/**
 * Exchange Configuration Page
 *
 * View and control exchange settings including pause/unpause.
 */

import { StatusBadge } from '@/components/admin';
import { useExchangeConfig } from '@/hooks/admin';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import {
  ArrowClockwise,
  Pause,
  Play,
  Warning,
  Wallet,
  Copy,
  Check,
  ArrowSquareOut,
  ShieldSlash,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 hover:bg-white/10 rounded transition-colors"
      aria-label="Copy"
    >
      {copied ? (
        <Check size={14} className="text-emerald-400" />
      ) : (
        <Copy size={14} className="text-white/40" />
      )}
    </button>
  );
}

function AddressDisplay({ label, value, explorerUrl }: { label: string; value: string; explorerUrl?: string }) {
  const truncated = `${value.slice(0, 8)}...${value.slice(-8)}`;

  return (
    <div className="flex items-center justify-between py-3 border-b border-white/10 last:border-0">
      <span className="text-white/60">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-white">{truncated}</span>
        <CopyButton value={value} />
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 hover:bg-white/10 rounded transition-colors"
          >
            <ArrowSquareOut size={14} className="text-white/40" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function ConfigPage() {
  const { config, isLoading, error, refetch, isAdmin, txPending, pause, unpause } = useExchangeConfig();
  const { publicKey, connected } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const [showConfirm, setShowConfirm] = useState<'pause' | 'unpause' | null>(null);

  const handlePauseAction = async (action: 'pause' | 'unpause') => {
    try {
      const fn = action === 'pause' ? pause : unpause;
      const signature = await fn();
      toast.success(
        <div>
          <div>Exchange {action === 'pause' ? 'paused' : 'unpaused'} successfully</div>
          <a
            href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-white/60 hover:text-white underline"
          >
            View transaction
          </a>
        </div>
      );
      setShowConfirm(null);
    } catch (err) {
      // Log full error to console for debugging
      console.error(`[ConfigPage] ${action}() error:`, err);
      if (err && typeof err === 'object') {
        console.error('[ConfigPage] Error details:', JSON.stringify(err, null, 2));
      }
      toast.error(err instanceof Error ? err.message : `Failed to ${action} exchange`);
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-light text-white">Exchange Configuration</h1>
        <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-lg">
          <div className="flex items-center gap-3 text-rose-400">
            <Warning size={24} />
            <div>
              <div className="font-medium">Error Loading Configuration</div>
              <div className="text-sm text-rose-400/80 mt-1">{error}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-light text-white">Exchange Configuration</h1>
          <p className="text-white/60 mt-1">View and control exchange settings</p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          aria-label="Refresh"
        >
          <ArrowClockwise size={20} className="text-white/60" />
        </button>
      </div>

      {/* Pause Status Card */}
      <div
        className={`p-6 rounded-lg border ${
          isLoading
            ? 'bg-white/5 border-white/10'
            : config?.isPaused
              ? 'bg-rose-500/10 border-rose-500/30'
              : 'bg-emerald-500/10 border-emerald-500/30'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="text-white/60 text-sm mb-2">Exchange Status</div>
            {isLoading ? (
              <div className="h-8 w-32 bg-white/10 rounded animate-pulse" />
            ) : (
              <div className="flex items-center gap-3">
                <StatusBadge status={config?.isPaused ? 'paused' : 'running'} className="text-base" />
                {config?.isPaused && (
                  <span className="text-rose-400/80 text-sm">Trading is currently disabled</span>
                )}
              </div>
            )}
          </div>

          {!isLoading && config && (
            <div className="flex flex-col gap-2">
              {!connected ? (
                <button
                  onClick={() => setWalletModalVisible(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-white/90 transition-colors"
                >
                  <Wallet size={18} />
                  Connect Wallet
                </button>
              ) : !isAdmin ? (
                <div className="flex items-center gap-2 text-amber-400 text-sm">
                  <Warning size={16} />
                  Connected wallet is not admin authority
                </div>
              ) : showConfirm ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowConfirm(null)}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 border border-white/10 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handlePauseAction(showConfirm)}
                    disabled={txPending}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ${
                      showConfirm === 'pause'
                        ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30'
                        : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {txPending ? 'Confirming...' : `Confirm ${showConfirm}`}
                  </button>
                </div>
              ) : config.isPaused ? (
                <button
                  onClick={() => setShowConfirm('unpause')}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 rounded-lg transition-colors"
                >
                  <Play size={18} weight="fill" />
                  Unpause Exchange
                </button>
              ) : (
                <button
                  onClick={() => setShowConfirm('pause')}
                  className="flex items-center gap-2 px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-lg transition-colors"
                >
                  <Pause size={18} weight="fill" />
                  Pause Exchange
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Configuration Details */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-white/5 border border-white/10 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : config ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Addresses */}
          <div className="p-6 bg-white/5 border border-white/10 rounded-lg">
            <h2 className="text-lg font-medium text-white mb-4">Addresses</h2>
            <div className="space-y-1">
              <AddressDisplay
                label="Authority"
                value={config.authority}
                explorerUrl={`https://explorer.solana.com/address/${config.authority}?cluster=devnet`}
              />
              <AddressDisplay
                label="Fee Recipient"
                value={config.feeRecipient}
                explorerUrl={`https://explorer.solana.com/address/${config.feeRecipient}?cluster=devnet`}
              />
              <AddressDisplay
                label="Arcium Cluster"
                value={config.arciumCluster}
              />
            </div>
          </div>

          {/* Fees */}
          <div className="p-6 bg-white/5 border border-white/10 rounded-lg">
            <h2 className="text-lg font-medium text-white mb-4">Fee Configuration</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-white/60">Maker Fee</span>
                <span className="text-white font-mono">
                  {config.makerFeeBps} bps ({(config.makerFeeBps / 100).toFixed(2)}%)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60">Taker Fee</span>
                <span className="text-white font-mono">
                  {config.takerFeeBps} bps ({(config.takerFeeBps / 100).toFixed(2)}%)
                </span>
              </div>
            </div>
          </div>

          {/* Statistics */}
          <div className="p-6 bg-white/5 border border-white/10 rounded-lg">
            <h2 className="text-lg font-medium text-white mb-4">Statistics</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-white/60">Trading Pairs</span>
                <span className="text-white font-mono">{config.pairCount.toString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60">Total Orders</span>
                <span className="text-white font-mono">{config.orderCount.toString()}</span>
              </div>
            </div>
          </div>

          {/* Blacklist */}
          <div className="p-6 bg-white/5 border border-white/10 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-white">Blacklist</h2>
              <Link
                href="/admin/blacklist"
                className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
              >
                <ShieldSlash size={16} />
                Manage
              </Link>
            </div>
            <div className="space-y-2">
              <div className="text-white/60 text-sm">Merkle Root</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-white/80 truncate max-w-[200px]">
                  {config.blacklistRoot.slice(0, 16)}...
                </span>
                <CopyButton value={config.blacklistRoot} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
