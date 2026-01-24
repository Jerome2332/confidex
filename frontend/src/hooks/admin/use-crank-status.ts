'use client';

/**
 * Crank Status Hook
 *
 * Polls crank service status and provides control functions.
 */

import { useAdminAuth } from './use-admin-auth';
import { useCallback, useEffect, useState } from 'react';

export type CrankStatus = 'stopped' | 'starting' | 'running' | 'paused' | 'error';

export interface CrankMetrics {
  status: CrankStatus;
  totalPolls: number;
  successfulMatches: number;
  failedMatches: number;
  consecutiveErrors: number;
  openOrderCount: number;
  pendingMatches: number;
  lastPollTime?: string;
  lastError?: string;
}

interface CrankStatusResponse {
  status: CrankStatus;
  metrics: CrankMetrics;
  config?: {
    pollIntervalMs: number;
    maxConsecutiveErrors: number;
  };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function useCrankStatus(pollInterval = 10000) {
  const { authHeaders, isAuthenticated } = useAdminAuth();
  const [data, setData] = useState<CrankStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!isAuthenticated) {
      setError('API key required');
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/admin/crank/status`, {
        headers: authHeaders,
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Invalid API key');
        }
        throw new Error(`Failed to fetch crank status: ${res.status}`);
      }

      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch crank status');
    } finally {
      setIsLoading(false);
    }
  }, [authHeaders, isAuthenticated]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(interval);
  }, [fetchStatus, pollInterval]);

  const sendCommand = useCallback(
    async (command: 'start' | 'stop' | 'pause' | 'resume' | 'skip-pending-mpc') => {
      if (!isAuthenticated) {
        throw new Error('API key required');
      }

      const res = await fetch(`${API_BASE}/api/admin/crank/${command}`, {
        method: 'POST',
        headers: authHeaders,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Command failed: ${res.status}`);
      }

      const result = await res.json();
      await fetchStatus();
      return result;
    },
    [authHeaders, isAuthenticated, fetchStatus]
  );

  return {
    status: data?.status,
    metrics: data?.metrics,
    config: data?.config,
    isLoading,
    error,
    refetch: fetchStatus,
    start: () => sendCommand('start'),
    stop: () => sendCommand('stop'),
    pause: () => sendCommand('pause'),
    resume: () => sendCommand('resume'),
    skipPendingMpc: () => sendCommand('skip-pending-mpc'),
  };
}
