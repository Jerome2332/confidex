'use client';

/**
 * Admin Dashboard
 *
 * Overview page showing key metrics and quick actions.
 */

import { StatCard, StatusBadge } from '@/components/admin';
import { useCrankStatus, useHealthStatus } from '@/hooks/admin';
import { useSharedWebSocket } from '@/hooks/streaming';
import {
  Gear,
  Heartbeat,
  ListNumbers,
  Wallet,
  ArrowClockwise,
  Play,
  Pause,
  WifiHigh,
  WifiSlash,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { toast } from 'sonner';

export default function AdminDashboardPage() {
  const { status: crankStatus, metrics, isLoading: crankLoading, error: crankError, start, pause } = useCrankStatus();
  const { overall: healthStatus, subsystems, isLoading: healthLoading, error: healthError } = useHealthStatus();
  const { isConnected: wsConnected, status: wsStatus, reconnectAttempts } = useSharedWebSocket();

  const walletBalance = subsystems?.wallet?.details?.balanceSol as number | undefined;

  const handleQuickStart = async () => {
    try {
      await start();
      toast.success('Crank service started');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start crank');
    }
  };

  const handleQuickPause = async () => {
    try {
      await pause();
      toast.success('Crank service paused');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to pause crank');
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-light text-white">Dashboard</h1>
        <p className="text-white/60 mt-1">System overview and quick actions</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-6 bg-white/5 border border-white/10 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-white/60 text-sm">Crank Status</span>
            <Gear size={20} className="text-white/40" />
          </div>
          <div className="mt-3">
            {crankLoading ? (
              <div className="h-6 w-20 bg-white/10 rounded animate-pulse" />
            ) : crankError ? (
              <span className="text-rose-400 text-sm">{crankError}</span>
            ) : (
              <StatusBadge status={crankStatus || 'stopped'} />
            )}
          </div>
        </div>

        <StatCard
          label="Open Orders"
          value={crankLoading ? '' : (metrics?.openOrderCount ?? 0).toString()}
          icon={ListNumbers}
          loading={crankLoading}
        />

        <div className="p-6 bg-white/5 border border-white/10 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-white/60 text-sm">System Health</span>
            <Heartbeat size={20} className="text-white/40" />
          </div>
          <div className="mt-3">
            {healthLoading ? (
              <div className="h-6 w-20 bg-white/10 rounded animate-pulse" />
            ) : healthError ? (
              <span className="text-rose-400 text-sm">Error</span>
            ) : (
              <StatusBadge status={healthStatus || 'unhealthy'} />
            )}
          </div>
        </div>

        <StatCard
          label="Wallet Balance"
          value={healthLoading ? '' : walletBalance !== undefined ? `${walletBalance.toFixed(4)} SOL` : 'N/A'}
          icon={Wallet}
          loading={healthLoading}
          trend={walletBalance !== undefined && walletBalance < 0.1 ? 'down' : 'neutral'}
        />

        <div className="p-6 bg-white/5 border border-white/10 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-white/60 text-sm">WebSocket</span>
            {wsConnected ? (
              <WifiHigh size={20} className="text-emerald-400" />
            ) : (
              <WifiSlash size={20} className="text-amber-400" />
            )}
          </div>
          <div className="mt-3">
            <StatusBadge
              status={
                wsConnected ? 'healthy' :
                wsStatus === 'connecting' ? 'degraded' :
                'unhealthy'
              }
            />
          </div>
          {reconnectAttempts > 0 && (
            <div className="mt-2 text-xs text-white/40">
              Reconnect attempts: {reconnectAttempts}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="space-y-4">
        <h2 className="text-lg font-medium text-white">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          {crankStatus === 'stopped' || crankStatus === 'error' ? (
            <button
              onClick={handleQuickStart}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 rounded-lg transition-colors"
            >
              <Play size={18} weight="fill" />
              Start Crank
            </button>
          ) : crankStatus === 'running' ? (
            <button
              onClick={handleQuickPause}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 rounded-lg transition-colors"
            >
              <Pause size={18} weight="fill" />
              Pause Crank
            </button>
          ) : null}

          <Link
            href="/admin/health"
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 rounded-lg transition-colors"
          >
            <Heartbeat size={18} />
            View Health Details
          </Link>

          <Link
            href="/admin/crank"
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 rounded-lg transition-colors"
          >
            <Gear size={18} />
            Crank Management
          </Link>
        </div>
      </div>

      {/* Metrics Overview */}
      {metrics && !crankLoading && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-white">Crank Metrics</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="text-white/60 text-sm">Total Polls</div>
              <div className="text-xl font-medium text-white mt-1">{metrics.totalPolls}</div>
            </div>
            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="text-white/60 text-sm">Successful Matches</div>
              <div className="text-xl font-medium text-emerald-400 mt-1">{metrics.successfulMatches}</div>
            </div>
            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="text-white/60 text-sm">Failed Matches</div>
              <div className="text-xl font-medium text-rose-400 mt-1">{metrics.failedMatches}</div>
            </div>
            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="text-white/60 text-sm">Pending Matches</div>
              <div className="text-xl font-medium text-amber-400 mt-1">{metrics.pendingMatches}</div>
            </div>
          </div>
        </div>
      )}

      {/* Subsystem Status */}
      {subsystems && !healthLoading && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-white">Subsystem Status</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Object.entries(subsystems).map(([name, health]) => (
              <div
                key={name}
                className={`p-3 rounded-lg border ${
                  health.status === 'healthy'
                    ? 'bg-emerald-500/5 border-emerald-500/20'
                    : health.status === 'degraded'
                      ? 'bg-amber-500/5 border-amber-500/20'
                      : 'bg-rose-500/5 border-rose-500/20'
                }`}
              >
                <div className="text-white/80 text-sm font-medium capitalize">{name}</div>
                <div
                  className={`text-xs mt-1 ${
                    health.status === 'healthy'
                      ? 'text-emerald-400'
                      : health.status === 'degraded'
                        ? 'text-amber-400'
                        : 'text-rose-400'
                  }`}
                >
                  {health.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
