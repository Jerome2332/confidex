'use client';

/**
 * Health Status Hook
 *
 * Polls the detailed health endpoint for system status.
 */

import { useCallback, useEffect, useState } from 'react';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface SubsystemHealth {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface HealthCheckResult {
  status: HealthStatus;
  timestamp: string;
  version: string;
  uptime: number;
  subsystems: {
    rpc: SubsystemHealth;
    database: SubsystemHealth;
    crank: SubsystemHealth;
    mpc: SubsystemHealth;
    wallet: SubsystemHealth;
    prover: SubsystemHealth;
  };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function useHealthStatus(pollInterval = 30000) {
  const [data, setData] = useState<HealthCheckResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/health/detailed`);

      if (!res.ok) {
        throw new Error(`Health check failed: ${res.status}`);
      }

      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, pollInterval);
    return () => clearInterval(interval);
  }, [fetchHealth, pollInterval]);

  return {
    overall: data?.status,
    subsystems: data?.subsystems,
    version: data?.version,
    uptime: data?.uptime,
    timestamp: data?.timestamp,
    isLoading,
    error,
    refetch: fetchHealth,
  };
}
