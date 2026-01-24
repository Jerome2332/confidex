'use client';

/**
 * Crank Management Page
 *
 * Control and monitor the crank service.
 */

import { StatusBadge } from '@/components/admin';
import { useCrankStatus } from '@/hooks/admin';
import {
  Play,
  Stop,
  Pause,
  ArrowClockwise,
  SkipForward,
  Warning,
  Clock,
  CheckCircle,
  XCircle,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { toast } from 'sonner';

export default function CrankManagementPage() {
  const {
    status,
    metrics,
    config,
    isLoading,
    error,
    refetch,
    start,
    stop,
    pause,
    resume,
    skipPendingMpc,
  } = useCrankStatus(5000); // 5s polling for crank page

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  const handleAction = async (action: 'start' | 'stop' | 'pause' | 'resume', fn: () => Promise<unknown>) => {
    setActionLoading(action);
    try {
      await fn();
      toast.success(`Crank ${action} successful`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action} crank`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSkipPending = async () => {
    setActionLoading('skip');
    try {
      const result = await skipPendingMpc();
      toast.success(result.message || 'Skipped pending MPC computations');
      setShowSkipConfirm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to skip pending MPC');
    } finally {
      setActionLoading(null);
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-light text-white">Crank Service</h1>
        <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-lg">
          <div className="flex items-center gap-3 text-rose-400">
            <Warning size={24} />
            <div>
              <div className="font-medium">Error Loading Crank Status</div>
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
          <h1 className="text-2xl font-light text-white">Crank Service</h1>
          <p className="text-white/60 mt-1">Control and monitor order matching</p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          aria-label="Refresh"
        >
          <ArrowClockwise size={20} className="text-white/60" />
        </button>
      </div>

      {/* Status Card */}
      <div className="p-6 bg-white/5 border border-white/10 rounded-lg">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-white/60 text-sm mb-2">Current Status</div>
            {isLoading ? (
              <div className="h-8 w-24 bg-white/10 rounded animate-pulse" />
            ) : (
              <StatusBadge status={status || 'stopped'} className="text-base" />
            )}
          </div>
          {metrics?.lastError && (
            <div className="text-rose-400/80 text-sm max-w-md">
              Last error: {metrics.lastError}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-3">
          {(status === 'stopped' || status === 'error') && (
            <button
              onClick={() => handleAction('start', start)}
              disabled={actionLoading !== null}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 rounded-lg transition-colors disabled:opacity-50"
            >
              <Play size={18} weight="fill" />
              {actionLoading === 'start' ? 'Starting...' : 'Start'}
            </button>
          )}

          {status === 'running' && (
            <>
              <button
                onClick={() => handleAction('pause', pause)}
                disabled={actionLoading !== null}
                className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 rounded-lg transition-colors disabled:opacity-50"
              >
                <Pause size={18} weight="fill" />
                {actionLoading === 'pause' ? 'Pausing...' : 'Pause'}
              </button>
              <button
                onClick={() => handleAction('stop', stop)}
                disabled={actionLoading !== null}
                className="flex items-center gap-2 px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-lg transition-colors disabled:opacity-50"
              >
                <Stop size={18} weight="fill" />
                {actionLoading === 'stop' ? 'Stopping...' : 'Stop'}
              </button>
            </>
          )}

          {status === 'paused' && (
            <>
              <button
                onClick={() => handleAction('resume', resume)}
                disabled={actionLoading !== null}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 rounded-lg transition-colors disabled:opacity-50"
              >
                <Play size={18} weight="fill" />
                {actionLoading === 'resume' ? 'Resuming...' : 'Resume'}
              </button>
              <button
                onClick={() => handleAction('stop', stop)}
                disabled={actionLoading !== null}
                className="flex items-center gap-2 px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-lg transition-colors disabled:opacity-50"
              >
                <Stop size={18} weight="fill" />
                {actionLoading === 'stop' ? 'Stopping...' : 'Stop'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      {metrics && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-white">Metrics</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="flex items-center gap-2 text-white/60 text-sm">
                <Clock size={16} />
                Total Polls
              </div>
              <div className="text-2xl font-medium text-white mt-2">{metrics.totalPolls}</div>
            </div>

            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="flex items-center gap-2 text-white/60 text-sm">
                <CheckCircle size={16} className="text-emerald-400" />
                Successful Matches
              </div>
              <div className="text-2xl font-medium text-emerald-400 mt-2">{metrics.successfulMatches}</div>
            </div>

            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="flex items-center gap-2 text-white/60 text-sm">
                <XCircle size={16} className="text-rose-400" />
                Failed Matches
              </div>
              <div className="text-2xl font-medium text-rose-400 mt-2">{metrics.failedMatches}</div>
            </div>

            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="flex items-center gap-2 text-white/60 text-sm">
                <Warning size={16} className="text-amber-400" />
                Consecutive Errors
              </div>
              <div className={`text-2xl font-medium mt-2 ${metrics.consecutiveErrors > 5 ? 'text-rose-400' : 'text-white'}`}>
                {metrics.consecutiveErrors}
              </div>
            </div>

            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="text-white/60 text-sm">Open Orders</div>
              <div className="text-2xl font-medium text-white mt-2">{metrics.openOrderCount}</div>
            </div>

            <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="text-white/60 text-sm">Pending Matches</div>
              <div className="text-2xl font-medium text-amber-400 mt-2">{metrics.pendingMatches}</div>
            </div>
          </div>
        </div>
      )}

      {/* Skip Pending MPC */}
      {metrics && metrics.pendingMatches > 0 && (
        <div className="p-6 bg-amber-500/5 border border-amber-500/20 rounded-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-amber-400 font-medium">
                <Warning size={20} />
                Pending MPC Computations
              </div>
              <p className="text-white/60 text-sm mt-2">
                There are {metrics.pendingMatches} pending MPC computations. If these are stuck,
                you can skip them to allow the crank to continue.
              </p>
            </div>
            {!showSkipConfirm ? (
              <button
                onClick={() => setShowSkipConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-lg transition-colors whitespace-nowrap"
              >
                <SkipForward size={18} />
                Skip All
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSkipConfirm(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 border border-white/10 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSkipPending}
                  disabled={actionLoading === 'skip'}
                  className="flex items-center gap-2 px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 rounded-lg transition-colors disabled:opacity-50"
                >
                  {actionLoading === 'skip' ? 'Skipping...' : 'Confirm Skip'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Config */}
      {config && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-white">Configuration</h2>
          <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-white/60 text-sm">Poll Interval</div>
                <div className="text-white font-mono mt-1">{config.pollIntervalMs}ms</div>
              </div>
              <div>
                <div className="text-white/60 text-sm">Max Consecutive Errors</div>
                <div className="text-white font-mono mt-1">{config.maxConsecutiveErrors}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
