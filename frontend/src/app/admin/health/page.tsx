'use client';

/**
 * System Health Page
 *
 * Displays detailed health status for all subsystems.
 */

import { StatusBadge } from '@/components/admin';
import { useHealthStatus, type SubsystemHealth } from '@/hooks/admin';
import {
  ArrowClockwise,
  Globe,
  Database,
  Gear,
  Lock,
  Wallet,
  Certificate,
  Clock,
  Info,
  ArrowSquareOut,
} from '@phosphor-icons/react';

const subsystemIcons: Record<string, React.ElementType> = {
  rpc: Globe,
  database: Database,
  crank: Gear,
  mpc: Lock,
  wallet: Wallet,
  prover: Certificate,
};

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function SubsystemCard({ name, health }: { name: string; health: SubsystemHealth }) {
  const Icon = subsystemIcons[name] || Info;

  const statusColors = {
    healthy: 'bg-emerald-500/10 border-emerald-500/30',
    degraded: 'bg-amber-500/10 border-amber-500/30',
    unhealthy: 'bg-rose-500/10 border-rose-500/30',
  };

  return (
    <div className={`p-5 rounded-lg border ${statusColors[health.status]}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <Icon
            size={24}
            className={
              health.status === 'healthy'
                ? 'text-emerald-400'
                : health.status === 'degraded'
                  ? 'text-amber-400'
                  : 'text-rose-400'
            }
          />
          <div>
            <div className="text-white font-medium capitalize">{name}</div>
            {health.latencyMs !== undefined && (
              <div className="text-white/40 text-xs flex items-center gap-1 mt-0.5">
                <Clock size={12} />
                {health.latencyMs}ms
              </div>
            )}
          </div>
        </div>
        <StatusBadge status={health.status} />
      </div>

      {health.message && (
        <div className="text-white/60 text-sm mb-3">{health.message}</div>
      )}

      {health.details && Object.keys(health.details).length > 0 && (
        <div className="space-y-2 pt-3 border-t border-white/10">
          {Object.entries(health.details).map(([key, value]) => (
            <div key={key} className="flex justify-between text-sm">
              <span className="text-white/40 capitalize">{key.replace(/_/g, ' ')}</span>
              <span className="text-white/80 font-mono text-xs max-w-[200px] truncate">
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HealthPage() {
  const { overall, subsystems, version, uptime, timestamp, isLoading, error, refetch } = useHealthStatus(15000);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-light text-white">System Health</h1>
          <p className="text-white/60 mt-1">Monitor all subsystem status</p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`${API_BASE}/metrics`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm bg-white/5 hover:bg-white/10 text-white/60 border border-white/10 rounded-lg transition-colors"
          >
            <ArrowSquareOut size={16} />
            Prometheus Metrics
          </a>
          <button
            onClick={() => refetch()}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            aria-label="Refresh"
          >
            <ArrowClockwise size={20} className="text-white/60" />
          </button>
        </div>
      </div>

      {/* Overall Status Banner */}
      <div
        className={`p-6 rounded-lg border ${
          overall === 'healthy'
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : overall === 'degraded'
              ? 'bg-amber-500/10 border-amber-500/30'
              : 'bg-rose-500/10 border-rose-500/30'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {isLoading ? (
              <div className="h-10 w-32 bg-white/10 rounded animate-pulse" />
            ) : error ? (
              <div className="text-rose-400">{error}</div>
            ) : (
              <>
                <div
                  className={`text-3xl font-light capitalize ${
                    overall === 'healthy'
                      ? 'text-emerald-400'
                      : overall === 'degraded'
                        ? 'text-amber-400'
                        : 'text-rose-400'
                  }`}
                >
                  {overall}
                </div>
                <div
                  className={`w-3 h-3 rounded-full animate-pulse ${
                    overall === 'healthy'
                      ? 'bg-emerald-400'
                      : overall === 'degraded'
                        ? 'bg-amber-400'
                        : 'bg-rose-400'
                  }`}
                />
              </>
            )}
          </div>

          {!isLoading && !error && (
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-white/40">Version</span>
                <span className="text-white/80 ml-2 font-mono">{version}</span>
              </div>
              <div>
                <span className="text-white/40">Uptime</span>
                <span className="text-white/80 ml-2">{uptime ? formatUptime(uptime) : 'N/A'}</span>
              </div>
              <div>
                <span className="text-white/40">Last Check</span>
                <span className="text-white/80 ml-2">
                  {timestamp ? new Date(timestamp).toLocaleTimeString() : 'N/A'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Subsystem Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-48 bg-white/5 border border-white/10 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : subsystems ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(subsystems).map(([name, health]) => (
            <SubsystemCard key={name} name={name} health={health} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
