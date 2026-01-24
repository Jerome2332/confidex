/**
 * Status Badge
 *
 * Semantic status indicator badge.
 */

type StatusType = 'healthy' | 'degraded' | 'unhealthy' | 'running' | 'starting' | 'stopped' | 'paused' | 'error';

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

const statusStyles: Record<StatusType, string> = {
  healthy: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  running: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  starting: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  degraded: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  paused: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  unhealthy: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  stopped: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  error: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

const statusLabels: Record<StatusType, string> = {
  healthy: 'Healthy',
  running: 'Running',
  starting: 'Starting',
  degraded: 'Degraded',
  paused: 'Paused',
  unhealthy: 'Unhealthy',
  stopped: 'Stopped',
  error: 'Error',
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusStyles[status]} ${className}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
          status === 'healthy' || status === 'running'
            ? 'bg-emerald-400'
            : status === 'degraded' || status === 'paused' || status === 'starting'
              ? 'bg-amber-400'
              : 'bg-rose-400'
        }`}
      />
      {statusLabels[status]}
    </span>
  );
}
