'use client';

import { useEffect } from 'react';
import { ArrowCounterClockwise, Bug, Warning } from '@phosphor-icons/react';

/**
 * Global Error Boundary
 *
 * Catches unhandled errors in the application and displays a user-friendly
 * error page with recovery options.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to console in development
    console.error('Global error caught:', error);

    // In production, this would send to error tracking service (e.g., Sentry)
    if (process.env.NODE_ENV === 'production') {
      // TODO: Send to error tracking when PRD-008 (Monitoring) is implemented
      // sendToErrorTracking(error);
    }
  }, [error]);

  const isNetworkError = error.message?.toLowerCase().includes('network') ||
                         error.message?.toLowerCase().includes('fetch');

  const isWalletError = error.message?.toLowerCase().includes('wallet') ||
                        error.message?.toLowerCase().includes('signature');

  return (
    <div
      className="min-h-screen bg-black flex items-center justify-center p-4"
      role="alert"
      aria-live="assertive"
    >
      <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-xl p-8 text-center">
        {/* Error Icon */}
        <div className="flex justify-center mb-6">
          <div className="p-4 bg-rose-500/20 rounded-full">
            {isNetworkError ? (
              <Warning size={48} className="text-rose-400" weight="fill" aria-hidden="true" />
            ) : (
              <Bug size={48} className="text-rose-400" weight="fill" aria-hidden="true" />
            )}
          </div>
        </div>

        {/* Error Title */}
        <h1 className="text-2xl font-light text-white mb-2">
          {isNetworkError ? 'Connection Error' :
           isWalletError ? 'Wallet Error' :
           'Something went wrong'}
        </h1>

        {/* Error Description */}
        <p className="text-white/60 mb-6">
          {isNetworkError ? (
            'Unable to connect to the network. Please check your internet connection and try again.'
          ) : isWalletError ? (
            'There was an issue with your wallet. Please reconnect and try again.'
          ) : (
            'An unexpected error occurred. Our team has been notified and is working on a fix.'
          )}
        </p>

        {/* Error Details (Development Only) */}
        {process.env.NODE_ENV === 'development' && (
          <details className="mb-6 text-left">
            <summary className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors">
              Error Details (Dev Only)
            </summary>
            <pre className="mt-2 p-3 bg-black/50 rounded-lg text-xs text-rose-400 overflow-auto max-h-40">
              {error.message}
              {error.stack && (
                <>
                  {'\n\n'}
                  {error.stack}
                </>
              )}
              {error.digest && (
                <>
                  {'\n\n'}
                  Digest: {error.digest}
                </>
              )}
            </pre>
          </details>
        )}

        {/* Recovery Actions */}
        <div className="flex flex-col gap-3">
          <button
            onClick={reset}
            className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white font-medium transition-colors"
            aria-label="Try again"
          >
            <ArrowCounterClockwise size={20} weight="bold" aria-hidden="true" />
            Try Again
          </button>

          <button
            onClick={() => window.location.href = '/'}
            className="w-full py-3 px-4 text-white/60 hover:text-white transition-colors"
            aria-label="Return to home page"
          >
            Return to Home
          </button>
        </div>

        {/* Support Link */}
        <p className="mt-6 text-sm text-white/40">
          Need help?{' '}
          <a
            href="https://github.com/Jerome2332/confidex/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/60 hover:text-white underline transition-colors"
          >
            Report an issue
          </a>
        </p>
      </div>
    </div>
  );
}
