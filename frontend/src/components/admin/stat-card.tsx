'use client';

/**
 * Stat Card
 *
 * Reusable metric display card for admin dashboard.
 */

import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: PhosphorIcon;
  trend?: 'up' | 'down' | 'neutral';
  loading?: boolean;
}

export function StatCard({ label, value, icon: Icon, trend, loading }: StatCardProps) {
  const trendColors = {
    up: 'text-emerald-400',
    down: 'text-rose-400',
    neutral: 'text-white/60',
  };

  return (
    <div className="p-6 bg-white/5 border border-white/10 rounded-lg">
      <div className="flex items-center justify-between">
        <span className="text-white/60 text-sm">{label}</span>
        <Icon size={20} className="text-white/40" />
      </div>
      <div className="mt-2">
        {loading ? (
          <div className="h-8 w-24 bg-white/10 rounded animate-pulse" />
        ) : (
          <span className={`text-2xl font-medium ${trend ? trendColors[trend] : 'text-white'}`}>
            {value}
          </span>
        )}
      </div>
    </div>
  );
}
