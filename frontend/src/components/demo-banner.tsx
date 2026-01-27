'use client';

import { FC } from 'react';
import { Warning, ArrowSquareOut } from '@phosphor-icons/react';
import Link from 'next/link';
import { ZK_PROOFS_ENABLED } from '@/lib/constants';

/**
 * Banner that displays when ZK proofs are disabled (demo mode)
 * Shows a clear warning that the application is running without ZK verification
 * and links to documentation explaining the technology
 */
export const DemoBanner: FC = () => {
  // Don't show banner if ZK proofs are enabled
  if (ZK_PROOFS_ENABLED) {
    return null;
  }

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30">
      <div className="container mx-auto px-4 py-2">
        <div className="flex items-center justify-center gap-3 text-sm">
          <Warning size={16} className="text-amber-400 flex-shrink-0" />
          <span className="text-amber-400/90">
            <strong className="text-amber-400">Demo Mode</strong>
            {' - '}
            ZK eligibility proofs are disabled. In production, all trades require cryptographic proof of compliance.
          </span>
          <Link
            href="/docs#zk-layer"
            className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 underline underline-offset-2"
          >
            Learn more
            <ArrowSquareOut size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
};
