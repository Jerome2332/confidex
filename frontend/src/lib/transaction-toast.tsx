'use client';

import { toast } from 'sonner';
import { CheckCircle, XCircle, SpinnerGap, ArrowSquareOut, Warning } from '@phosphor-icons/react';

/**
 * Transaction Toast Utilities
 *
 * Enhanced toast notifications for Solana transaction states.
 * Provides consistent UX for transaction lifecycle with explorer links.
 */

interface TransactionToastOptions {
  /** Transaction signature (shown and linked to explorer) */
  signature?: string;
  /** Toast ID for updates */
  id?: string | number;
  /** Duration in ms (default: 5000, use Infinity for persistent) */
  duration?: number;
  /** Additional description */
  description?: string;
  /** Network for explorer link */
  network?: 'devnet' | 'mainnet-beta' | 'testnet';
}

const getExplorerUrl = (signature: string, network: string = 'devnet') => {
  return `https://explorer.solana.com/tx/${signature}?cluster=${network}`;
};

/**
 * Show a pending transaction toast
 */
export function toastPending(message: string, options?: TransactionToastOptions) {
  return toast(message, {
    id: options?.id,
    duration: options?.duration ?? Infinity,
    icon: <SpinnerGap className="animate-spin text-white/60" size={18} />,
    description: options?.description,
  });
}

/**
 * Show a transaction submitted toast (awaiting confirmation)
 */
export function toastSubmitted(message: string, options?: TransactionToastOptions) {
  const id = options?.id ?? toast.loading(message);

  return toast(message, {
    id,
    duration: options?.duration ?? Infinity,
    icon: <SpinnerGap className="animate-spin text-blue-400" size={18} />,
    description: options?.signature ? (
      <a
        href={getExplorerUrl(options.signature, options.network)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-blue-400 hover:text-blue-300 underline"
      >
        View on Explorer
        <ArrowSquareOut size={12} />
      </a>
    ) : options?.description,
  });
}

/**
 * Show a transaction confirmed toast
 */
export function toastConfirmed(message: string, options?: TransactionToastOptions) {
  return toast.success(message, {
    id: options?.id,
    duration: options?.duration ?? 5000,
    icon: <CheckCircle className="text-emerald-400" size={18} weight="fill" />,
    description: options?.signature ? (
      <a
        href={getExplorerUrl(options.signature, options.network)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 underline"
      >
        View on Explorer
        <ArrowSquareOut size={12} />
      </a>
    ) : options?.description,
  });
}

/**
 * Show a transaction failed toast
 */
export function toastFailed(message: string, options?: TransactionToastOptions & { error?: string }) {
  return toast.error(message, {
    id: options?.id,
    duration: options?.duration ?? 8000,
    icon: <XCircle className="text-rose-400" size={18} weight="fill" />,
    description: options?.signature ? (
      <div className="space-y-1">
        {options.error && (
          <p className="text-rose-400/80 text-xs">{options.error}</p>
        )}
        <a
          href={getExplorerUrl(options.signature, options.network)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-rose-400 hover:text-rose-300 underline"
        >
          View on Explorer
          <ArrowSquareOut size={12} />
        </a>
      </div>
    ) : (
      options?.error || options?.description
    ),
  });
}

/**
 * Show a warning toast (e.g., for simulation failures)
 */
export function toastWarning(message: string, options?: TransactionToastOptions) {
  return toast.warning(message, {
    id: options?.id,
    duration: options?.duration ?? 6000,
    icon: <Warning className="text-amber-400" size={18} weight="fill" />,
    description: options?.description,
  });
}

/**
 * Full transaction lifecycle handler
 *
 * Usage:
 * ```ts
 * const tx = transactionToast('Placing order...');
 * tx.submitted(signature);
 * // ... after confirmation
 * tx.confirmed('Order placed!');
 * // ... or on error
 * tx.failed('Transaction failed', error.message);
 * ```
 */
export function transactionToast(initialMessage: string, options?: TransactionToastOptions) {
  const id = options?.id ?? Date.now();
  const network = options?.network ?? 'devnet';

  // Show initial pending state
  toastPending(initialMessage, { id });

  return {
    id,

    /** Update to submitted state */
    submitted: (signature: string, message?: string) => {
      toastSubmitted(message ?? 'Transaction submitted...', {
        id,
        signature,
        network,
      });
    },

    /** Update to confirmed state */
    confirmed: (message: string, signature?: string) => {
      toastConfirmed(message, {
        id,
        signature,
        network,
        duration: 5000,
      });
    },

    /** Update to failed state */
    failed: (message: string, error?: string, signature?: string) => {
      toastFailed(message, {
        id,
        signature,
        network,
        error,
        duration: 8000,
      });
    },

    /** Update to warning state */
    warning: (message: string, description?: string) => {
      toastWarning(message, {
        id,
        description,
      });
    },

    /** Dismiss the toast */
    dismiss: () => {
      toast.dismiss(id);
    },
  };
}

/**
 * Privacy-specific transaction toasts
 */
export const privacyToast = {
  /** ZK proof generation started */
  proofGenerating: (id?: string | number) =>
    toast('Generating eligibility proof...', {
      id,
      duration: Infinity,
      icon: <SpinnerGap className="animate-spin text-violet-400" size={18} />,
      description: 'Creating zero-knowledge proof',
    }),

  /** ZK proof generated */
  proofGenerated: (id?: string | number) =>
    toast.success('Proof generated', {
      id,
      duration: 3000,
      icon: <CheckCircle className="text-violet-400" size={18} weight="fill" />,
      description: 'Eligibility verified via ZK',
    }),

  /** Encryption started */
  encrypting: (id?: string | number) =>
    toast('Encrypting order data...', {
      id,
      duration: Infinity,
      icon: <SpinnerGap className="animate-spin text-cyan-400" size={18} />,
      description: 'Using Arcium MPC encryption',
    }),

  /** Encryption complete */
  encrypted: (id?: string | number) =>
    toast.success('Order encrypted', {
      id,
      duration: 3000,
      icon: <CheckCircle className="text-cyan-400" size={18} weight="fill" />,
      description: 'V2 pure ciphertext format',
    }),

  /** MPC matching queued */
  mpcQueued: (id?: string | number) =>
    toast('Order queued for MPC matching...', {
      id,
      duration: Infinity,
      icon: <SpinnerGap className="animate-spin text-indigo-400" size={18} />,
      description: 'Awaiting Arcium cluster',
    }),

  /** MPC matching complete */
  mpcMatched: (id?: string | number, matched?: boolean) =>
    toast.success(matched ? 'Order matched!' : 'Order placed', {
      id,
      duration: 5000,
      icon: <CheckCircle className="text-indigo-400" size={18} weight="fill" />,
      description: matched ? 'MPC comparison successful' : 'Awaiting counterparty',
    }),
};
